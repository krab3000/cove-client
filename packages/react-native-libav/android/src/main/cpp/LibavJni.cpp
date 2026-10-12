// JNI side of com.libav.LibavPlayer: one NativePlayer per view, owning the shared engine's Player and the
// window of the view's Surface. Player callbacks arrive on engine threads and are forwarded to the Kotlin object,
// which posts them to the main thread.

#include <android/log.h>
#include <android/native_window_jni.h>
#include <jni.h>
#include <sys/system_properties.h>

#include <chrono>
#include <future>
#include <memory>
#include <string>
#include <thread>

extern "C" {
#include <libavcodec/jni.h>
#include <libavformat/avio.h>
#include <libavutil/error.h>
#include <libavutil/log.h>
}

#include "AndroidVideoSink.h"
#include "Platform.h"
#include "Player.h"
#include "Trace.h"

using namespace ReactNativeLibav;

namespace {

JavaVM *g_vm = nullptr;

// Detaches engine threads from the VM when they exit.
struct ThreadAttachment {
  bool attached = false;
  ~ThreadAttachment() {
    if (attached)
      g_vm->DetachCurrentThread();
  }
};
thread_local ThreadAttachment t_attachment;

JNIEnv *Env() {
  JNIEnv *env = nullptr;
  if (g_vm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) == JNI_OK)
    return env;
  g_vm->AttachCurrentThread(&env, nullptr);
  t_attachment.attached = true;
  return env;
}

jbyteArray Utf8(JNIEnv *env, const std::string &text) {
  jbyteArray bytes = env->NewByteArray(jsize(text.size()));
  env->SetByteArrayRegion(bytes, 0, jsize(text.size()), reinterpret_cast<const jbyte *>(text.data()));
  return bytes;
}

std::string FromUtf8(JNIEnv *env, jbyteArray bytes) {
  const jsize size = env->GetArrayLength(bytes);
  std::string text(size_t(size), '\0');
  env->GetByteArrayRegion(bytes, 0, size, reinterpret_cast<jbyte *>(text.data()));
  return text;
}

std::string JsonString(const std::string &text) {
  std::string out = "\"";
  for (const unsigned char c : text) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          char escaped[8];
          snprintf(escaped, sizeof(escaped), "\\u%04x", c);
          out += escaped;
        } else {
          out += char(c); // UTF-8 passes through
        }
    }
  }
  return out + "\"";
}

// The load event payload, matching the JS LoadEvent (plus aspect, used by the view's layout).
std::string LoadJson(const MediaInfo &info) {
  std::string json = "{\"duration\":" + std::to_string(info.duration) + ",\"width\":" + std::to_string(info.width) +
      ",\"height\":" + std::to_string(info.height) + ",\"aspect\":" + std::to_string(info.aspect) +
      ",\"hasAudio\":" + (info.hasAudio ? "true" : "false") + ",\"hwDecoding\":" + (info.hwDecoding ? "true" : "false") +
      ",\"codec\":" + JsonString(info.codec) + ",\"audioTrack\":" + std::to_string(info.audioTrack) + ",\"audioTracks\":[";
  for (size_t i = 0; i < info.audioTracks.size(); ++i) {
    const AudioTrackInfo &t = info.audioTracks[i];
    json += std::string(i ? "," : "") + "{\"index\":" + std::to_string(t.index) + ",\"language\":" +
        JsonString(t.language) + ",\"title\":" + JsonString(t.title) + ",\"codec\":" + JsonString(t.codec) +
        ",\"channels\":" + std::to_string(t.channels) + ",\"sampleRate\":" + std::to_string(t.sampleRate) + "}";
  }
  return json + "]}";
}

// The Kotlin LibavPlayer the callbacks go to. Each player's callbacks share it, so a player that is still shutting
// down after its view released the NativePlayer (see Dispose) calls into a live object.
struct JavaListener {
  jobject object = nullptr; // global ref
  jmethodID onLoad = nullptr, onProgress = nullptr, onSeek = nullptr, onEnd = nullptr, onError = nullptr;

  ~JavaListener() { Env()->DeleteGlobalRef(object); }
};

// How long the caller (the main thread) waits for a player to shut down. Stopping releases its MediaCodec, which
// takes milliseconds; it is waited for so the next decoder finds the surface free.
constexpr auto kDisposeWait = std::chrono::seconds(1);

// Destroys a player on a thread of its own and waits for it at most kDisposeWait. A decoder stuck inside MediaCodec
// (the emulator's c2.goldfish decoders never answer some calls) would otherwise block the main thread for good: an
// ANR as soon as a view is removed. Past the wait, the player finishes, or stays stuck, on that thread.
void Dispose(std::unique_ptr<Player> player) {
  if (!player)
    return;
  LIBAV_TRACE("dispose player (wait)");
  auto done = std::make_shared<std::promise<void>>();
  std::future<void> finished = done->get_future();
  std::thread([player = std::move(player), done]() mutable {
    SetThreadName("libav dispose");
    {
      LIBAV_TRACE("dispose player");
      player.reset();
    }
    done->set_value();
  }).detach();
  if (finished.wait_for(kDisposeWait) == std::future_status::timeout)
    Log("player shutdown is stuck (in MediaCodec?); continuing without it");
}

struct NativePlayer {
  std::shared_ptr<JavaListener> listener;
  ANativeWindow *window = nullptr;
  std::unique_ptr<Player> player;
  bool paused = false, muted = false, loop = false, tlsVerify = true;
  float volume = 1.0f;

  void SetWindow(ANativeWindow *newWindow) {
    Dispose(std::move(player)); // the decoder renders into the window: stop it first
    if (window)
      ANativeWindow_release(window); // the sink holds its own reference while a disposed player winds down
    window = newWindow;
  }
};

NativePlayer *From(jlong handle) {
  return reinterpret_cast<NativePlayer *>(handle);
}

// com.libav.HttpSource's static methods (looked up in JNI_OnLoad: engine threads cannot find app classes).
struct {
  jclass cls = nullptr;
  jmethodID open = nullptr, size = nullptr, read = nullptr, cancel = nullptr, close = nullptr;
} g_httpSource;

// http(s) sources read through Android's HTTP stack and a chunk cache (HttpSource.kt, HttpChunkCache.kt) instead of
// FFmpeg's http protocol. FFmpeg's reads land in its own buffer, wrapped as a direct ByteBuffer (no copy).
class JavaHttpSource final : public ByteSource {
 public:
  explicit JavaHttpSource(const std::string &url) {
    JNIEnv *env = Env();
    jstring text = env->NewStringUTF(url.c_str());
    m_handle = env->CallStaticLongMethod(g_httpSource.cls, g_httpSource.open, text);
    env->DeleteLocalRef(text);
  }

  ~JavaHttpSource() override { Env()->CallStaticVoidMethod(g_httpSource.cls, g_httpSource.close, m_handle); }

  int Read(uint8_t *buffer, int size) override {
    JNIEnv *env = Env();
    jobject dst = env->NewDirectByteBuffer(buffer, size);
    const jint read = env->CallStaticIntMethod(g_httpSource.cls, g_httpSource.read, m_handle, jlong(m_position), dst,
                                               jint(size));
    env->DeleteLocalRef(dst);
    if (Failed(env) || read < 0)
      return AVERROR(EIO);
    m_position += read;
    return read;
  }

  int64_t Seek(int64_t offset, int whence) override {
    switch (whence) {
      case AVSEEK_SIZE:
        return Size();
      case SEEK_SET:
        m_position = offset;
        break;
      case SEEK_CUR:
        m_position += offset;
        break;
      case SEEK_END: {
        const int64_t size = Size();
        if (size < 0)
          return AVERROR(ENOSYS);
        m_position = size + offset;
        break;
      }
      default:
        return AVERROR(EINVAL);
    }
    return m_position;
  }

  void Abort() override { Env()->CallStaticVoidMethod(g_httpSource.cls, g_httpSource.cancel, m_handle); }

  const char *Name() const override { return "android http"; }

 private:
  int64_t Size() {
    JNIEnv *env = Env();
    const jlong size = env->CallStaticLongMethod(g_httpSource.cls, g_httpSource.size, m_handle);
    return Failed(env) ? -1 : size;
  }

  static bool Failed(JNIEnv *env) {
    if (!env->ExceptionCheck())
      return false;
    env->ExceptionDescribe();
    env->ExceptionClear();
    return true;
  }

  jlong m_handle = 0;
  int64_t m_position = 0;
};

// Android's HTTP for http(s) sources, unless the system property debug.libav.http is "ffmpeg" (FFmpeg's own http
// protocol, for comparison):  adb shell setprop debug.libav.http ffmpeg
ByteSourceFactory HttpSourceFactory() {
  char value[PROP_VALUE_MAX] = {};
  __system_property_get("debug.libav.http", value);
  if (std::string(value) == "ffmpeg" || !g_httpSource.cls)
    return nullptr;
  return [](const std::string &url) { return std::make_unique<JavaHttpSource>(url); };
}

// The view's inputOptions, then, for http(s) sources, the system property debug.libav.input_opts (read at each open,
// so options can be tried without a rebuild; its keys win). E.g.
//   adb shell setprop debug.libav.input_opts multiple_requests=1:probesize=1000000
std::string InputOptions(const std::string &fromView, const std::string &source) {
  char value[PROP_VALUE_MAX] = {};
  if (source.rfind("http://", 0) == 0 || source.rfind("https://", 0) == 0)
    __system_property_get("debug.libav.input_opts", value);
  const std::string fromProperty = value;
  if (fromView.empty() || fromProperty.empty())
    return fromView.empty() ? fromProperty : fromView;
  return fromView + ":" + fromProperty;
}

// FFmpeg's own log -> logcat (tag "ffmpeg"). The level comes from the system property debug.libav.ffmpeg_log, read
// at load: quiet, error, warning (the default), info, verbose, debug, trace; e.g. to see the HTTP requests and
// seeks of an open:  adb shell setprop debug.libav.ffmpeg_log verbose  (then restart the app).
void ForwardFFmpegLog() {
  char value[PROP_VALUE_MAX] = {};
  __system_property_get("debug.libav.ffmpeg_log", value);
  const std::string name = value;
  const int level = name == "quiet" ? AV_LOG_QUIET : name == "error" ? AV_LOG_ERROR : name == "info" ? AV_LOG_INFO
      : name == "verbose" ? AV_LOG_VERBOSE : name == "debug" ? AV_LOG_DEBUG : name == "trace" ? AV_LOG_TRACE
      : AV_LOG_WARNING;
  av_log_set_level(level);
  av_log_set_callback([](void *avcl, int level, const char *fmt, va_list args) {
    if (level > av_log_get_level())
      return;
    char line[1024];
    int prefix = 1;
    av_log_format_line2(avcl, level, fmt, args, line, sizeof(line), &prefix);
    const int priority = level <= AV_LOG_ERROR ? ANDROID_LOG_ERROR : level <= AV_LOG_WARNING ? ANDROID_LOG_WARN
        : level <= AV_LOG_INFO ? ANDROID_LOG_INFO : ANDROID_LOG_DEBUG;
    __android_log_write(priority, "ffmpeg", line);
  });
}

} // namespace

extern "C" JNIEXPORT jint JNI_OnLoad(JavaVM *vm, void * /*reserved*/) {
  g_vm = vm;
  av_jni_set_java_vm(vm, nullptr); // for FFmpeg's JNI MediaCodec path, should it be used
  ForwardFFmpegLog();
  InitTracing();
  JNIEnv *env = nullptr;
  if (vm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) == JNI_OK) {
    if (jclass cls = env->FindClass("com/libav/HttpSource")) {
      g_httpSource.cls = static_cast<jclass>(env->NewGlobalRef(cls));
      g_httpSource.open = env->GetStaticMethodID(cls, "open", "(Ljava/lang/String;)J");
      g_httpSource.size = env->GetStaticMethodID(cls, "size", "(J)J");
      g_httpSource.read = env->GetStaticMethodID(cls, "read", "(JJLjava/nio/ByteBuffer;I)I");
      g_httpSource.cancel = env->GetStaticMethodID(cls, "cancel", "(J)V");
      g_httpSource.close = env->GetStaticMethodID(cls, "close", "(J)V");
      env->DeleteLocalRef(cls);
    }
    if (env->ExceptionCheck()) { // a missing class or method: FFmpeg's http then
      env->ExceptionClear();
      g_httpSource.cls = nullptr;
    }
  }
  return JNI_VERSION_1_6;
}

extern "C" JNIEXPORT jlong JNICALL Java_com_libav_LibavPlayer_nativeCreate(JNIEnv *env, jobject self) {
  auto listener = std::make_shared<JavaListener>();
  listener->object = env->NewGlobalRef(self);
  jclass cls = env->GetObjectClass(self);
  listener->onLoad = env->GetMethodID(cls, "onNativeLoad", "(I[B)V");
  listener->onProgress = env->GetMethodID(cls, "onNativeProgress", "(IDD)V");
  listener->onSeek = env->GetMethodID(cls, "onNativeSeek", "(ID)V");
  listener->onEnd = env->GetMethodID(cls, "onNativeEnd", "(I)V");
  listener->onError = env->GetMethodID(cls, "onNativeError", "(I[B)V");
  auto *np = new NativePlayer();
  np->listener = std::move(listener);
  return reinterpret_cast<jlong>(np);
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeRelease(JNIEnv *, jobject, jlong handle) {
  NativePlayer *np = From(handle);
  np->SetWindow(nullptr);
  delete np;
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeSetSurface(JNIEnv *env, jobject, jlong handle,
                                                                             jobject surface) {
  From(handle)->SetWindow(surface ? ANativeWindow_fromSurface(env, surface) : nullptr);
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeOpen(JNIEnv *env, jobject, jlong handle,
                                                                       jint generation, jbyteArray source,
                                                                       jboolean hardwareDecoding, jint audioTrack,
                                                                       jbyteArray inputOptions) {
  NativePlayer *np = From(handle);
  Dispose(std::move(np->player));
  if (!np->window)
    return;

  // Engine threads -> Kotlin. The generation lets the Kotlin side drop events of a source it has replaced.
  PlayerCallbacks callbacks;
  callbacks.onLoad = [l = np->listener, generation](const MediaInfo &info) {
    JNIEnv *e = Env();
    jbyteArray json = Utf8(e, LoadJson(info));
    e->CallVoidMethod(l->object, l->onLoad, generation, json);
    e->DeleteLocalRef(json);
  };
  callbacks.onProgress = [l = np->listener, generation](double currentTime, double duration) {
    Env()->CallVoidMethod(l->object, l->onProgress, generation, currentTime, duration);
  };
  callbacks.onSeek = [l = np->listener, generation](double currentTime) {
    Env()->CallVoidMethod(l->object, l->onSeek, generation, currentTime);
  };
  callbacks.onEnd = [l = np->listener, generation] { Env()->CallVoidMethod(l->object, l->onEnd, generation); };
  callbacks.onError = [l = np->listener, generation](const std::string &message) {
    JNIEnv *e = Env();
    jbyteArray text = Utf8(e, message);
    e->CallVoidMethod(l->object, l->onError, generation, text);
    e->DeleteLocalRef(text);
  };

  np->player = std::make_unique<Player>(std::make_shared<AndroidVideoSink>(np->window), std::move(callbacks));
  np->player->SetPaused(np->paused);
  np->player->SetMuted(np->muted);
  np->player->SetVolume(np->volume);
  np->player->SetLoop(np->loop);
  np->player->SetTlsVerify(np->tlsVerify);
  std::string url = FromUtf8(env, source);
  np->player->SetInputOptions(InputOptions(FromUtf8(env, inputOptions), url));
  np->player->SetByteSourceFactory(HttpSourceFactory());
  np->player->Open(std::move(url), hardwareDecoding, audioTrack);
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeClose(JNIEnv *, jobject, jlong handle) {
  Dispose(std::move(From(handle)->player));
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeSetPaused(JNIEnv *, jobject, jlong handle,
                                                                            jboolean paused) {
  NativePlayer *np = From(handle);
  np->paused = paused;
  if (np->player)
    np->player->SetPaused(paused);
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeSetMuted(JNIEnv *, jobject, jlong handle,
                                                                           jboolean muted) {
  NativePlayer *np = From(handle);
  np->muted = muted;
  if (np->player)
    np->player->SetMuted(muted);
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeSetVolume(JNIEnv *, jobject, jlong handle,
                                                                            jfloat volume) {
  NativePlayer *np = From(handle);
  np->volume = volume;
  if (np->player)
    np->player->SetVolume(volume);
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeSetLoop(JNIEnv *, jobject, jlong handle,
                                                                          jboolean loop) {
  NativePlayer *np = From(handle);
  np->loop = loop;
  if (np->player)
    np->player->SetLoop(loop);
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeSetTlsVerify(JNIEnv *, jobject, jlong handle,
                                                                               jboolean verify) {
  From(handle)->tlsVerify = verify; // applies to the next open
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeSetAudioTrack(JNIEnv *, jobject, jlong handle,
                                                                                jint index) {
  if (NativePlayer *np = From(handle); np->player)
    np->player->SetAudioTrack(index);
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeSeek(JNIEnv *, jobject, jlong handle,
                                                                       jdouble seconds) {
  if (NativePlayer *np = From(handle); np->player)
    np->player->Seek(seconds);
}
