// JNI side of com.libav.LibavPlayer: one NativePlayer per view, owning the engine playing (the shared engine's Player,
// or MpvPlayer for the view's engine "mpv") and the view's Surface (its window, and a global reference for mpv). Player callbacks arrive on engine threads and are forwarded to the Kotlin object,
// which posts them to the main thread.

#include <android/log.h>
#include <android/native_window_jni.h>
#include <jni.h>
#include <sys/system_properties.h>

#include <algorithm>
#include <atomic>
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
#include "HttpCache.h"
#include "MpvPlayer.h"
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
template <typename Engine>
void Dispose(std::unique_ptr<Engine> player) {
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
  jobject surface = nullptr; // global ref to the Surface: mpv's "wid"
  std::unique_ptr<Player> player;
  std::unique_ptr<MpvPlayer> mpv;
  bool paused = false, muted = false, loop = false, tlsVerify = true;
  float volume = 1.0f;

  void Stop() {
    Dispose(std::move(player)); // the decoder renders into the window: stop it first
    Dispose(std::move(mpv));
  }

  void SetWindow(JNIEnv *env, jobject newSurface) {
    Stop();
    if (window)
      ANativeWindow_release(window); // the sink holds its own reference while a disposed player winds down
    if (surface)
      env->DeleteGlobalRef(surface); // no mpv left using it (Stop waited, or gave up on a stuck one: see Dispose)
    window = newSurface ? ANativeWindow_fromSurface(env, newSurface) : nullptr;
    surface = newSurface ? env->NewGlobalRef(newSurface) : nullptr;
  }
};

NativePlayer *From(jlong handle) {
  return reinterpret_cast<NativePlayer *>(handle);
}

// com.libav.HttpFetch: the HTTP part of the C++ cache, and FetchResult's fields.
struct {
  jclass cls = nullptr;
  jmethodID fetch = nullptr, cancel = nullptr, setStreaming = nullptr, headers = nullptr;
  jfieldID status = nullptr, code = nullptr, length = nullptr, total = nullptr, etag = nullptr,
           lastModified = nullptr, error = nullptr;
} g_httpFetch;

std::string JavaString(JNIEnv *env, jobject object, jfieldID field) {
  auto text = static_cast<jstring>(env->GetObjectField(object, field));
  if (!text)
    return {};
  const char *chars = env->GetStringUTFChars(text, nullptr);
  std::string value = chars ? chars : "";
  env->ReleaseStringUTFChars(text, chars);
  env->DeleteLocalRef(text);
  return value;
}

bool JavaFailed(JNIEnv *env) {
  if (!env->ExceptionCheck())
    return false;
  env->ExceptionDescribe();
  env->ExceptionClear();
  return true;
}

// The cache's fetcher on Android: HttpFetch.kt (Android's HTTP stack, HttpAuth, keep-alive, user CAs). The bytes
// land straight in the cache's buffer (a direct ByteBuffer over it). Cancelling the token disconnects the request.
class JavaHttpFetcher final : public HttpFetcher {
 public:
  FetchResult Fetch(const FetchRequest &request, uint8_t *buffer, size_t capacity, CancelToken &token) override {
    FetchResult result;
    static std::atomic<int64_t> nextId{0};
    const jlong id = ++nextId;
    if (!token.SetHook([id] {
          JNIEnv *e = Env();
          e->CallStaticVoidMethod(g_httpFetch.cls, g_httpFetch.cancel, id);
          JavaFailed(e);
        })) {
      result.status = FetchResult::Status::Cancelled;
      return result;
    }
    JNIEnv *env = Env();
    env->PushLocalFrame(16); // worker threads never return to Java: free each fetch's local references
    jstring url = env->NewStringUTF(request.url.c_str());
    jstring ifRange = request.ifRange.empty() ? nullptr : env->NewStringUTF(request.ifRange.c_str());
    jobject dst = env->NewDirectByteBuffer(buffer, jlong(capacity));
    jobject r = env->CallStaticObjectMethod(g_httpFetch.cls, g_httpFetch.fetch, id, url, jlong(request.start),
                                            jlong(request.end), ifRange, dst);
    token.ClearHook();
    if (JavaFailed(env) || !r) {
      result.status = FetchResult::Status::NetworkError;
      result.error = "HttpFetch.fetch failed";
    } else {
      result.status = FetchResult::Status(env->GetIntField(r, g_httpFetch.status));
      result.httpCode = env->GetIntField(r, g_httpFetch.code);
      result.length = size_t(std::max(0, int(env->GetIntField(r, g_httpFetch.length))));
      result.totalSize = env->GetLongField(r, g_httpFetch.total);
      result.etag = JavaString(env, r, g_httpFetch.etag);
      result.lastModified = JavaString(env, r, g_httpFetch.lastModified);
      result.error = JavaString(env, r, g_httpFetch.error);
    }
    env->PopLocalFrame(nullptr);
    return result;
  }

  void SetStreaming(bool on) override {
    JNIEnv *env = Env();
    env->CallStaticVoidMethod(g_httpFetch.cls, g_httpFetch.setStreaming, jboolean(on));
    JavaFailed(env);
  }

  const char *Name() const override { return "kotlin"; }
};

// The player's source for http(s) URLs, by the debug switch debug.libav.http (read at each open):
//   kotlin (default)  the C++ cache over HttpFetch.kt     ffmpeg-fetch  the C++ cache over FFmpeg's http
//   ffmpeg            no cache: FFmpeg's http protocol
ByteSourceFactory HttpSourceFactory(bool tlsVerify) {
  return HttpCache::MakeSourceFactory(HttpCache::ModeFromDebug(), tlsVerify);
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
    if (jclass cls = env->FindClass("com/libav/HttpFetch")) {
      g_httpFetch.cls = static_cast<jclass>(env->NewGlobalRef(cls));
      g_httpFetch.fetch = env->GetStaticMethodID(
          cls, "fetch", "(JLjava/lang/String;JJLjava/lang/String;Ljava/nio/ByteBuffer;)Lcom/libav/HttpFetch$FetchResult;");
      g_httpFetch.cancel = env->GetStaticMethodID(cls, "cancel", "(J)V");
      g_httpFetch.setStreaming = env->GetStaticMethodID(cls, "setStreaming", "(Z)V");
      g_httpFetch.headers = env->GetStaticMethodID(cls, "headers", "(Ljava/lang/String;)Ljava/lang/String;");
      env->DeleteLocalRef(cls);
    }
    if (jclass result = env->FindClass("com/libav/HttpFetch$FetchResult")) {
      g_httpFetch.status = env->GetFieldID(result, "status", "I");
      g_httpFetch.code = env->GetFieldID(result, "code", "I");
      g_httpFetch.length = env->GetFieldID(result, "length", "I");
      g_httpFetch.total = env->GetFieldID(result, "total", "J");
      g_httpFetch.etag = env->GetFieldID(result, "etag", "Ljava/lang/String;");
      g_httpFetch.lastModified = env->GetFieldID(result, "lastModified", "Ljava/lang/String;");
      g_httpFetch.error = env->GetFieldID(result, "error", "Ljava/lang/String;");
      env->DeleteLocalRef(result);
    }
    if (env->ExceptionCheck()) {
      env->ExceptionClear();
      g_httpFetch.cls = nullptr;
    }
    if (g_httpFetch.cls) {
      HttpCache::SetFetcher(std::make_shared<JavaHttpFetcher>());
      HttpCache::SetHeaderProvider([](const std::string &url) { // for the FFmpeg fetcher: HttpAuth's header
        JNIEnv *e = Env();
        e->PushLocalFrame(4);
        jstring text = e->NewStringUTF(url.c_str());
        auto headers = static_cast<jstring>(e->CallStaticObjectMethod(g_httpFetch.cls, g_httpFetch.headers, text));
        std::string value;
        if (!JavaFailed(e) && headers) {
          const char *chars = e->GetStringUTFChars(headers, nullptr);
          value = chars ? chars : "";
          e->ReleaseStringUTFChars(headers, chars);
        }
        e->PopLocalFrame(nullptr);
        return value;
      });
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
  np->SetWindow(Env(), nullptr);
  delete np;
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeSetSurface(JNIEnv *env, jobject, jlong handle,
                                                                             jobject surface) {
  From(handle)->SetWindow(env, surface);
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeOpen(JNIEnv *env, jobject, jlong handle,
                                                                       jint generation, jbyteArray source,
                                                                       jboolean hardwareDecoding, jint audioTrack,
                                                                       jbyteArray inputOptions, jboolean useMpv) {
  NativePlayer *np = From(handle);
  np->Stop();
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

  std::string url = FromUtf8(env, source);
  if (useMpv && MpvPlayer::Available()) {
    np->mpv = std::make_unique<MpvPlayer>(int64_t(reinterpret_cast<intptr_t>(np->surface)),
                                          ANativeWindow_getWidth(np->window), ANativeWindow_getHeight(np->window),
                                          std::move(callbacks));
    np->mpv->SetTlsVerify(np->tlsVerify);
    np->mpv->SetLoop(np->loop);
    np->mpv->SetByteSourceFactory(HttpSourceFactory(np->tlsVerify));
    np->mpv->Open(std::move(url), hardwareDecoding, audioTrack);
    np->mpv->SetPaused(np->paused);
    np->mpv->SetMuted(np->muted);
    np->mpv->SetVolume(np->volume);
    return;
  }
  if (useMpv)
    Log("mpv is not in this build: playing with libav");
  np->player = std::make_unique<Player>(std::make_shared<AndroidVideoSink>(np->window), std::move(callbacks));
  np->player->SetPaused(np->paused);
  np->player->SetMuted(np->muted);
  np->player->SetVolume(np->volume);
  np->player->SetLoop(np->loop);
  np->player->SetTlsVerify(np->tlsVerify);
  np->player->SetInputOptions(InputOptions(FromUtf8(env, inputOptions), url));
  np->player->SetByteSourceFactory(HttpSourceFactory(np->tlsVerify));
  np->player->Open(std::move(url), hardwareDecoding, audioTrack);
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeSetSurfaceSize(JNIEnv *, jobject, jlong handle,
                                                                                  jint width, jint height) {
  if (NativePlayer *np = From(handle); np->mpv)
    np->mpv->SetSurfaceSize(width, height);
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeClose(JNIEnv *, jobject, jlong handle) {
  From(handle)->Stop();
}

extern "C" JNIEXPORT jboolean JNICALL Java_com_libav_LibavEngines_nativeMpvAvailable(JNIEnv *, jclass) {
  return MpvPlayer::Available();
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeSetPaused(JNIEnv *, jobject, jlong handle,
                                                                            jboolean paused) {
  NativePlayer *np = From(handle);
  np->paused = paused;
  if (np->player)
    np->player->SetPaused(paused);
  if (np->mpv)
    np->mpv->SetPaused(paused);
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeSetMuted(JNIEnv *, jobject, jlong handle,
                                                                           jboolean muted) {
  NativePlayer *np = From(handle);
  np->muted = muted;
  if (np->player)
    np->player->SetMuted(muted);
  if (np->mpv)
    np->mpv->SetMuted(muted);
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeSetVolume(JNIEnv *, jobject, jlong handle,
                                                                            jfloat volume) {
  NativePlayer *np = From(handle);
  np->volume = volume;
  if (np->player)
    np->player->SetVolume(volume);
  if (np->mpv)
    np->mpv->SetVolume(volume);
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeSetLoop(JNIEnv *, jobject, jlong handle,
                                                                          jboolean loop) {
  NativePlayer *np = From(handle);
  np->loop = loop;
  if (np->player)
    np->player->SetLoop(loop);
  if (np->mpv)
    np->mpv->SetLoop(loop);
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeSetTlsVerify(JNIEnv *, jobject, jlong handle,
                                                                               jboolean verify) {
  From(handle)->tlsVerify = verify; // applies to the next open
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeSetAudioTrack(JNIEnv *, jobject, jlong handle,
                                                                                jint index) {
  NativePlayer *np = From(handle);
  if (np->player)
    np->player->SetAudioTrack(index);
  if (np->mpv)
    np->mpv->SetAudioTrack(index);
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeSeek(JNIEnv *, jobject, jlong handle,
                                                                       jdouble seconds) {
  NativePlayer *np = From(handle);
  if (np->player)
    np->player->Seek(seconds);
  if (np->mpv)
    np->mpv->Seek(seconds);
}

// com.libav.HttpFetch's natives: the C++ HTTP cache's platform facts, settings and state.

extern "C" JNIEXPORT void JNICALL Java_com_libav_HttpFetch_nativeSetPlatform(JNIEnv *env, jclass, jlong totalRam,
                                                                            jboolean lowRam, jstring dir,
                                                                            jlong quota) {
  PlatformInfo info;
  info.totalRam = uint64_t(std::max<jlong>(totalRam, 0));
  info.lowRam = lowRam;
  if (dir) {
    const char *chars = env->GetStringUTFChars(dir, nullptr);
    info.defaultDir = chars ? chars : "";
    env->ReleaseStringUTFChars(dir, chars);
  }
  info.diskQuota = uint64_t(std::max<jlong>(quota, 0));
  HttpCache::SetPlatform(info);
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_HttpFetch_nativeConfigure(JNIEnv *env, jclass, jlong chunkSize,
                                                                          jlong memorySize, jlong diskSize,
                                                                          jstring diskDir) {
  CacheOverrides overrides; // -1: derived from the device
  overrides.chunkSize = chunkSize;
  overrides.memorySize = memorySize;
  overrides.diskSize = diskSize;
  if (diskDir) {
    const char *chars = env->GetStringUTFChars(diskDir, nullptr);
    overrides.diskDir = chars ? chars : "";
    env->ReleaseStringUTFChars(diskDir, chars);
  }
  HttpCache::Override(overrides);
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_HttpFetch_nativeTrimMemory(JNIEnv *, jclass) {
  HttpCache::Instance()->TrimMemory();
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_HttpFetch_nativeClear(JNIEnv *, jclass) {
  HttpCache::Instance()->Clear();
}

extern "C" JNIEXPORT jbyteArray JNICALL Java_com_libav_HttpFetch_nativeStats(JNIEnv *env, jclass) {
  const CacheStats s = HttpCache::Instance()->Stats();
  const CacheConfig c = HttpCache::Instance()->Config();
  auto n = [](auto v) { return std::to_string(v); };
  const std::string json = "{\"chunkSize\":" + n(c.chunkSize) + ",\"ramBytes\":" + n(s.ramBytes) +
      ",\"ramLimit\":" + n(s.ramLimit) + ",\"ramChunks\":" + n(s.ramChunks) + ",\"liveChunkBytes\":" +
      n(s.liveChunkBytes) + ",\"fetches\":" + n(s.fetches) + ",\"fetchedBytes\":" + n(s.fetchedBytes) +
      ",\"fetchMs\":" + n(s.fetchMs) + ",\"failed\":" + n(s.failed) + ",\"inFlight\":" + n(s.inFlight) +
      ",\"disk\":{\"enabled\":" + (s.disk.enabled ? "true" : "false") + ",\"bytes\":" + n(s.disk.bytes) +
      ",\"limit\":" + n(s.disk.limit) + ",\"chunks\":" + n(s.disk.chunks) + ",\"writes\":" + n(s.disk.writes) +
      ",\"droppedWrites\":" + n(s.disk.droppedWrites) + ",\"reads\":" + n(s.disk.reads) + ",\"corrupt\":" +
      n(s.disk.corrupt) + ",\"evicted\":" + n(s.disk.evicted) + "}}";
  return Utf8(env, json);
}
