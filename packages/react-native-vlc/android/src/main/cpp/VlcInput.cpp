// libVLC's input from the app's byte cache, without HTTP in between: a libvlc media made with
// libvlc_media_new_callbacks, whose open / read / seek / close call the Kotlin CacheInput and its Readers
// (CacheInput.kt), which serve the bytes from HttpChunkCache's RAM and disk tiers and fetch what they lack. The same
// idea as react-native-libav's AVIOContext over its cache.
//
// libVLC is reached through the libvlc.so libvlc-android already loaded (dlopen + dlsym: no headers, no link-time
// dependency), and the Java objects' handles (VLCObject.getInstance(): the libvlc_instance_t*, libvlc_media_list_t*).
// The media is added to a Java MediaList, which wraps it in a Java Media (MediaList.getMediaAt): the player takes it
// as any other.

#include <android/log.h>
#include <dlfcn.h>
#include <jni.h>
#include <pthread.h>

#include <cstdint>
#include <sys/types.h>

#define TAG "RNVlcHttp"
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, TAG, __VA_ARGS__)

namespace {

// libVLC 3's C API, as far as used here (vlc/libvlc_media.h, vlc/libvlc_media_list.h).
struct libvlc_instance_t;
struct libvlc_media_t;
struct libvlc_media_list_t;
using OpenCb = int (*)(void *opaque, void **datap, uint64_t *sizep);
using ReadCb = ssize_t (*)(void *opaque, unsigned char *buf, size_t len);
using SeekCb = int (*)(void *opaque, uint64_t offset);
using CloseCb = void (*)(void *opaque);
using MediaNewCallbacks = libvlc_media_t *(*)(libvlc_instance_t *, OpenCb, ReadCb, SeekCb, CloseCb, void *);
using MediaRelease = void (*)(libvlc_media_t *);
using ListLock = void (*)(libvlc_media_list_t *);
using ListAddMedia = int (*)(libvlc_media_list_t *, libvlc_media_t *);

struct Vlc {
  MediaNewCallbacks mediaNewCallbacks = nullptr;
  MediaRelease mediaRelease = nullptr;
  ListLock listLock = nullptr, listUnlock = nullptr;
  ListAddMedia listAddMedia = nullptr;
};

Vlc g_vlc;
bool g_resolved = false;
pthread_once_t g_resolveOnce = PTHREAD_ONCE_INIT;

void Resolve() {
  void *lib = dlopen("libvlc.so", RTLD_NOW); // loaded already (LibVLC): this finds it
  if (!lib) {
    LOGW("libvlc.so: %s", dlerror());
    return;
  }
  g_vlc.mediaNewCallbacks = reinterpret_cast<MediaNewCallbacks>(dlsym(lib, "libvlc_media_new_callbacks"));
  g_vlc.mediaRelease = reinterpret_cast<MediaRelease>(dlsym(lib, "libvlc_media_release"));
  g_vlc.listLock = reinterpret_cast<ListLock>(dlsym(lib, "libvlc_media_list_lock"));
  g_vlc.listUnlock = reinterpret_cast<ListLock>(dlsym(lib, "libvlc_media_list_unlock"));
  g_vlc.listAddMedia = reinterpret_cast<ListAddMedia>(dlsym(lib, "libvlc_media_list_add_media"));
  g_resolved = g_vlc.mediaNewCallbacks && g_vlc.mediaRelease && g_vlc.listLock && g_vlc.listUnlock && g_vlc.listAddMedia;
  if (!g_resolved)
    LOGW("libvlc.so lacks the callback media API");
}

// Java: CacheInput and its Reader (classes found in JNI_OnLoad: libVLC's threads can't find app classes).
JavaVM *g_jvm = nullptr;
pthread_key_t g_attached;
jmethodID g_inputOpen, g_readerSize, g_readerRead, g_readerSeek, g_readerClose;

// The calling thread's JNIEnv. libVLC's input threads are attached here once, and detached when they end.
JNIEnv *Env() {
  JNIEnv *env = nullptr;
  if (g_jvm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) == JNI_OK)
    return env;
  JavaVMAttachArgs args{JNI_VERSION_1_6, "RNVlcInput", nullptr};
  if (g_jvm->AttachCurrentThread(&env, &args) != JNI_OK)
    return nullptr;
  pthread_setspecific(g_attached, env);
  return env;
}

bool Failed(JNIEnv *env) {
  if (!env->ExceptionCheck())
    return false;
  env->ExceptionDescribe();
  env->ExceptionClear();
  return true;
}

// The callbacks. opaque: a global ref to the CacheInput; data (from open): a global ref to that open's Reader.
int Open(void *opaque, void **datap, uint64_t *sizep) {
  *datap = nullptr;
  *sizep = UINT64_MAX;
  JNIEnv *env = Env();
  if (!env)
    return -1;
  jobject reader = env->CallObjectMethod(static_cast<jobject>(opaque), g_inputOpen);
  if (Failed(env) || !reader)
    return -1;
  const jlong size = env->CallLongMethod(reader, g_readerSize);
  if (Failed(env)) {
    env->DeleteLocalRef(reader);
    return -1;
  }
  if (size >= 0)
    *sizep = static_cast<uint64_t>(size);
  *datap = env->NewGlobalRef(reader);
  env->DeleteLocalRef(reader);
  return 0;
}

ssize_t Read(void *data, unsigned char *buf, size_t len) {
  JNIEnv *env = Env();
  if (!env || !data)
    return -1;
  jobject buffer = env->NewDirectByteBuffer(buf, static_cast<jlong>(len));
  if (Failed(env) || !buffer)
    return -1;
  const jint n = env->CallIntMethod(static_cast<jobject>(data), g_readerRead, buffer);
  env->DeleteLocalRef(buffer);
  if (Failed(env))
    return -1;
  return n;
}

int Seek(void *data, uint64_t offset) {
  JNIEnv *env = Env();
  if (!env || !data)
    return -1;
  const jint result = env->CallIntMethod(static_cast<jobject>(data), g_readerSeek, static_cast<jlong>(offset));
  return Failed(env) ? -1 : result;
}

void Close(void *data) {
  JNIEnv *env = Env();
  if (!env || !data)
    return;
  env->CallVoidMethod(static_cast<jobject>(data), g_readerClose);
  Failed(env);
  env->DeleteGlobalRef(static_cast<jobject>(data));
}

} // namespace

extern "C" JNIEXPORT jint JNI_OnLoad(JavaVM *vm, void *) {
  g_jvm = vm;
  pthread_key_create(&g_attached, [](void *) { g_jvm->DetachCurrentThread(); });
  JNIEnv *env = nullptr;
  if (vm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) != JNI_OK)
    return JNI_ERR;
  jclass input = env->FindClass("com/rnvlc/CacheInput");
  jclass reader = env->FindClass("com/rnvlc/CacheInput$Reader");
  if (!input || !reader)
    return JNI_ERR;
  g_inputOpen = env->GetMethodID(input, "open", "()Lcom/rnvlc/CacheInput$Reader;");
  g_readerSize = env->GetMethodID(reader, "size", "()J");
  g_readerRead = env->GetMethodID(reader, "read", "(Ljava/nio/ByteBuffer;)I");
  g_readerSeek = env->GetMethodID(reader, "seek", "(J)I");
  g_readerClose = env->GetMethodID(reader, "close", "()V");
  if (!g_inputOpen || !g_readerSize || !g_readerRead || !g_readerSeek || !g_readerClose)
    return JNI_ERR;
  return JNI_VERSION_1_6;
}

// A callback media for input, added to the media list (the Java MediaList wraps it in a Java Media). Returns the
// handle nativeRelease frees once the media is gone (after its player is released), or 0 on failure.
extern "C" JNIEXPORT jlong JNICALL Java_com_rnvlc_CacheInput_nativeNewInList(JNIEnv *env, jobject input, jlong list,
                                                                           jlong instance) {
  pthread_once(&g_resolveOnce, Resolve);
  if (!g_resolved || !list || !instance)
    return 0;
  jobject opaque = env->NewGlobalRef(input);
  libvlc_media_t *media = g_vlc.mediaNewCallbacks(reinterpret_cast<libvlc_instance_t *>(instance), Open, Read, Seek,
                                                  Close, opaque);
  if (!media) {
    env->DeleteGlobalRef(opaque);
    return 0;
  }
  auto *mediaList = reinterpret_cast<libvlc_media_list_t *>(list);
  g_vlc.listLock(mediaList);
  const int added = g_vlc.listAddMedia(mediaList, media);
  g_vlc.listUnlock(mediaList);
  g_vlc.mediaRelease(media); // the list (and the Java Media made from it) holds it
  if (added != 0) {
    env->DeleteGlobalRef(opaque);
    return 0;
  }
  return reinterpret_cast<jlong>(opaque);
}

extern "C" JNIEXPORT void JNICALL Java_com_rnvlc_CacheInput_nativeRelease(JNIEnv *env, jobject, jlong handle) {
  if (handle)
    env->DeleteGlobalRef(reinterpret_cast<jobject>(handle));
}
