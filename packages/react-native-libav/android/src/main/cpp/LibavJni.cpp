// JNI side of com.libav.LibavPlayer: one NativePlayer per view, owning the shared engine's Player and the
// window of the view's Surface. Player callbacks arrive on engine threads and are forwarded to the Kotlin object,
// which posts them to the main thread.

#include <android/native_window_jni.h>
#include <jni.h>

#include <memory>
#include <string>

extern "C" {
#include <libavcodec/jni.h>
}

#include "AndroidVideoSink.h"
#include "Platform.h"
#include "Player.h"

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

struct NativePlayer {
  jobject listener = nullptr; // the Kotlin LibavPlayer (global ref)
  jmethodID onLoad = nullptr, onProgress = nullptr, onSeek = nullptr, onEnd = nullptr, onError = nullptr;
  ANativeWindow *window = nullptr;
  std::unique_ptr<Player> player;
  bool paused = false, muted = false, loop = false;
  float volume = 1.0f;

  void SetWindow(ANativeWindow *newWindow) {
    player.reset(); // the decoder renders into the window: stop it first
    if (window)
      ANativeWindow_release(window);
    window = newWindow;
  }
};

NativePlayer *From(jlong handle) {
  return reinterpret_cast<NativePlayer *>(handle);
}

} // namespace

extern "C" JNIEXPORT jint JNI_OnLoad(JavaVM *vm, void * /*reserved*/) {
  g_vm = vm;
  av_jni_set_java_vm(vm, nullptr); // for FFmpeg's JNI MediaCodec path, should it be used
  return JNI_VERSION_1_6;
}

extern "C" JNIEXPORT jlong JNICALL Java_com_libav_LibavPlayer_nativeCreate(JNIEnv *env, jobject self) {
  auto *np = new NativePlayer();
  np->listener = env->NewGlobalRef(self);
  jclass cls = env->GetObjectClass(self);
  np->onLoad = env->GetMethodID(cls, "onNativeLoad", "(I[B)V");
  np->onProgress = env->GetMethodID(cls, "onNativeProgress", "(IDD)V");
  np->onSeek = env->GetMethodID(cls, "onNativeSeek", "(ID)V");
  np->onEnd = env->GetMethodID(cls, "onNativeEnd", "(I)V");
  np->onError = env->GetMethodID(cls, "onNativeError", "(I[B)V");
  return reinterpret_cast<jlong>(np);
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeRelease(JNIEnv *env, jobject, jlong handle) {
  NativePlayer *np = From(handle);
  np->SetWindow(nullptr);
  env->DeleteGlobalRef(np->listener);
  delete np;
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeSetSurface(JNIEnv *env, jobject, jlong handle,
                                                                             jobject surface) {
  From(handle)->SetWindow(surface ? ANativeWindow_fromSurface(env, surface) : nullptr);
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeOpen(JNIEnv *env, jobject, jlong handle,
                                                                       jint generation, jbyteArray source,
                                                                       jboolean hardwareDecoding, jint audioTrack) {
  NativePlayer *np = From(handle);
  np->player.reset();
  if (!np->window)
    return;

  // Engine threads -> Kotlin. The generation lets the Kotlin side drop events of a source it has replaced.
  PlayerCallbacks callbacks;
  callbacks.onLoad = [np, generation](const MediaInfo &info) {
    JNIEnv *e = Env();
    jbyteArray json = Utf8(e, LoadJson(info));
    e->CallVoidMethod(np->listener, np->onLoad, generation, json);
    e->DeleteLocalRef(json);
  };
  callbacks.onProgress = [np, generation](double currentTime, double duration) {
    Env()->CallVoidMethod(np->listener, np->onProgress, generation, currentTime, duration);
  };
  callbacks.onSeek = [np, generation](double currentTime) {
    Env()->CallVoidMethod(np->listener, np->onSeek, generation, currentTime);
  };
  callbacks.onEnd = [np, generation] { Env()->CallVoidMethod(np->listener, np->onEnd, generation); };
  callbacks.onError = [np, generation](const std::string &message) {
    JNIEnv *e = Env();
    jbyteArray text = Utf8(e, message);
    e->CallVoidMethod(np->listener, np->onError, generation, text);
    e->DeleteLocalRef(text);
  };

  np->player = std::make_unique<Player>(std::make_shared<AndroidVideoSink>(np->window), std::move(callbacks));
  np->player->SetPaused(np->paused);
  np->player->SetMuted(np->muted);
  np->player->SetVolume(np->volume);
  np->player->SetLoop(np->loop);
  np->player->Open(FromUtf8(env, source), hardwareDecoding, audioTrack);
}

extern "C" JNIEXPORT void JNICALL Java_com_libav_LibavPlayer_nativeClose(JNIEnv *, jobject, jlong handle) {
  From(handle)->player.reset();
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
