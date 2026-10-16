import 'dart:async';
import 'dart:math';

import 'dart:io' show Platform;

import 'package:flutter/widgets.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart';

import '../../api/cove_client.dart' hide Video;
import '../../api/models.dart' as cove;
import '../../data/library.dart';
import '../../state/prefs.dart';

// A resume position this close to either end starts from the beginning instead
const _resumeMinSec = 5.0;
const _resumeEndMarginSec = 15.0;
// While playing, what was watched is reported this often
const _reportEvery = Duration(seconds: 10);
// A jump forward less than this continues the span watched; more (or back) starts another
const _spanGapSec = 3.0;
const _spanMinSec = 0.5;

/// One video playing: libmpv through media_kit, the stream with the
/// session's JWT (its header follows every renewal), a clip played as its part of the parent's file (times are the
/// clip's), resuming where Cove saved it, and what was watched reported to Cove like its web player does.
class PlayerSession extends ChangeNotifier {
  PlayerSession({
    required this.client,
    required this.personal,
    required this.video,
    this.startAt,
    required this.onEnded,
  }) {
    _start();
  }

  final CoveClient client;
  final PersonalStore personal;
  final cove.Video video;

  /// A moment's start (seconds in the file), or null: resume
  final double? startAt;

  /// The video ended (autoplay goes on to the next)
  final VoidCallback onEnded;

  late final Player player = Player(
    configuration: PlayerConfiguration(
      title: 'Cove',
      bufferSize: prefs.memoryCacheMB > 0
          ? prefs.memoryCacheMB * 1024 * 1024
          : 64 * 1024 * 1024,
      logLevel: switch (prefs.playerLog) {
        'v' => MPVLogLevel.v,
        'info' => MPVLogLevel.info,
        _ => MPVLogLevel.warn,
      },
    ),
  );
  late final VideoController controller = VideoController(
    player,
    configuration: VideoControllerConfiguration(
      enableHardwareAcceleration: prefs.hardwareDecoding,
      hwdec: _hwdec,
      width: _output?.width.round(),
      height: _output?.height.round(),
    ),
  );

  /// The decoder: on Android MediaCodec, its frames copied out to mpv. Not zero-copy ("mediacodec", through
  /// mpv's AImageReader): after overlapping seeks it waited for a frame that never came ("acquireLatestImage failed:
  /// -30001") with the decoder's output buffers all taken, and playback hung until the app restarted (an S22). The
  /// copy costs more: a 4K60 stream dropped a third of its frames on a Galaxy Tab S6 Lite. Elsewhere whatever is safe.
  static String get _hwdec {
    if (!prefs.hardwareDecoding) return 'no';
    return Platform.isAndroid ? 'mediacodec-copy' : 'auto-safe';
  }

  /// The size mpv renders the video at: the video's, unless it is larger than the screen (a 4K video on a 2000×1200
  /// tablet renders at the screen's size, not into a 3840×2160 texture that is then scaled down every frame).
  /// Null: the video's own.
  Size? get _output {
    final file = video.primaryFile;
    final w = file?.width, h = file?.height;
    if (w == null || h == null || w == 0 || h == 0) return null;
    final screen = WidgetsBinding
        .instance
        .platformDispatcher
        .views
        .firstOrNull
        ?.physicalSize;
    if (screen == null || screen.isEmpty) return null;
    final long = max(screen.width, screen.height),
        short = min(screen.width, screen.height);
    final scale = min(1.0, min(long / max(w, h), short / min(w, h)));
    if (scale >= 1) return null;
    return Size((w * scale).roundToDouble(), (h * scale).roundToDouble());
  }

  final _subs = <StreamSubscription<Object?>>[];
  void Function()? _unbindToken;
  final String sessionId = _uuid();

  double get clipStart => video.clipStartSec ?? 0;
  double? get clipEnd => video.clipEndSec;

  bool loaded = false;
  bool playing = false;
  bool buffering = true;
  bool ended = false;
  bool seeking = false;
  String error = '';
  double _fileDuration = 0;
  double _time = 0; // seconds in the file
  double _buffered = 0;
  double rate = 1;
  double volume = 100;
  Tracks tracks = const Tracks();
  Track track = const Track();
  List<cove.Segment> segments = const [];
  cove.SpriteSheet? sprite;

  /// The clip's (or the video's) length.
  double get duration => max(0, (clipEnd ?? _fileDuration) - clipStart);

  /// Where it is, in the clip.
  double get position =>
      (_time - clipStart).clamp(0, duration > 0 ? duration : double.infinity);

  double get buffered => (_buffered - clipStart).clamp(
    0,
    duration > 0 ? duration : double.infinity,
  );

  NativePlayer? get _native =>
      player.platform is NativePlayer ? player.platform as NativePlayer : null;

  double? _resumeAt;
  bool _resumed = false;
  // The span being watched, in clip seconds
  double? _spanStart;
  double? _spanEnd;
  final _spans = <({double startSec, double endSec})>[];
  Timer? _reporter;
  bool _disposed = false;

  Future<void> _start() async {
    _subs.addAll([
      // Settings → Player log: mpv's messages, at that level, in the system's log (logcat: "mpv [cplayer] …")
      player.stream.log.listen(
        (l) => debugPrint('mpv [${l.prefix}] ${l.level}: ${l.text.trim()}'),
      ),
      player.stream.position.listen(_onPosition),
      player.stream.duration.listen((d) {
        _fileDuration = d.inMilliseconds / 1000;
        if (_fileDuration > 0 && !loaded) {
          loaded = true;
          _tryResume();
        }
        _changed();
      }),
      player.stream.playing.listen((p) {
        final was = playing;
        playing = p;
        if (p) ended = false;
        if (was && !p && !ended) _report('paused');
        _schedule();
        _changed();
      }),
      player.stream.buffering.listen((b) {
        buffering = b;
        _changed();
      }),
      player.stream.buffer.listen((b) {
        _buffered = b.inMilliseconds / 1000;
      }),
      player.stream.completed.listen((c) {
        if (c) _end();
      }),
      player.stream.rate.listen((r) {
        rate = r;
        _changed();
      }),
      player.stream.volume.listen((v) {
        volume = v;
        _changed();
      }),
      player.stream.tracks.listen((t) {
        tracks = t;
        _changed();
      }),
      player.stream.track.listen((t) {
        track = t;
        _changed();
      }),
      player.stream.error.listen((e) {
        if (!loaded) error = e;
        _changed();
      }),
    ]);

    // The JWT renews every 15 minutes: the stream's header follows (a seek after that re-requests with the new one)
    _unbindToken = client.onAccessToken((token) {
      _native?.setProperty(
        'http-header-fields',
        'Authorization: Bearer $token',
      );
    });

    final native = _native;
    if (native != null) {
      await native.setProperty('hwdec', _hwdec);
      await native.setProperty('cache-secs', '${prefs.readAheadSec}');
      await native.setProperty('tls-verify', prefs.tlsVerify ? 'yes' : 'no');
      if (prefs.subtitlesOff) await native.setProperty('sid', 'no');
    }

    // Where to start: a moment, else where Cove saved it (asked fresh: another device may have moved it)
    if (startAt != null) {
      _resumeAt = startAt! - clipStart;
    } else {
      unawaited(
        client.engagement([video.id]).then((e) {
          _resumeAt = e[video.id]?.resumeTime ?? 0;
          _tryResume();
        }, onError: (_) => _resumeAt = 0),
      );
    }
    segments = await personal.segments(video.id);
    _changed();
    unawaited(
      client.spriteSheet(video.id).then((s) {
        sprite = s;
        _changed();
      }),
    );
    await player.open(
      Media(client.streamUrl(video), httpHeaders: client.authHeaders),
    );
    if (clipStart > 0) await player.seek(_dur(clipStart));
  }

  void _tryResume() {
    final at = _resumeAt;
    if (_resumed || !loaded || at == null) return;
    _resumed = true;
    if (startAt != null ||
        (prefs.resume &&
            at > _resumeMinSec &&
            at < duration - _resumeEndMarginSec)) {
      seekTo(at);
    }
  }

  void _onPosition(Duration d) {
    final t = d.inMilliseconds / 1000;
    final rel = t - clipStart;
    // It plays after all (a hardware decoder that failed, then the software one): the error is past
    if (error.isNotEmpty && playing && t > _time) error = '';
    _time = t;
    if (seeking) seeking = false;
    // The span watched: on while it moves forward by a little
    if (playing && rel >= 0) {
      final end = _spanEnd;
      if (_spanStart != null &&
          end != null &&
          rel >= end &&
          rel - end < _spanGapSec) {
        _spanEnd = rel;
      } else {
        _closeSpan();
        _spanStart = rel;
        _spanEnd = rel;
      }
    }
    final clipEnd = this.clipEnd;
    if (clipEnd != null && t >= clipEnd && !ended) {
      player.pause();
      _end();
    }
    // The time on screen moves four times a second: every position event (each frame) would rebuild the player
    final now = DateTime.now();
    if (seeking ||
        now.difference(_lastTick) >= const Duration(milliseconds: 250)) {
      _lastTick = now;
      _changed();
    }
  }

  DateTime _lastTick = DateTime.fromMillisecondsSinceEpoch(0);

  void _closeSpan() {
    final s = _spanStart, e = _spanEnd;
    if (s != null && e != null && e - s >= _spanMinSec)
      _spans.add((startSec: s, endSec: e));
    _spanStart = _spanEnd = null;
  }

  void _end() {
    if (ended) return;
    ended = true;
    playing = false;
    _report('ended');
    _changed();
    onEnded();
  }

  void _schedule() {
    _reporter?.cancel();
    if (playing)
      _reporter = Timer.periodic(_reportEvery, (_) => _report('active'));
  }

  /// Reports the spans watched since the last report, where it is and its state.
  Future<void> _report(String state) async {
    if (duration <= 0) return;
    _closeSpan();
    if (playing && state == 'active') {
      _spanStart = position;
      _spanEnd = position;
    }
    final spans = [..._spans];
    _spans.clear();
    try {
      await client.recordPlayback(
        hostId: video.id,
        sessionId: sessionId,
        mediaDurationSec: duration,
        currentPositionSec: position,
        state: state,
        intervals: spans,
      );
      if (state != 'active') personal.refresh(video.id);
    } catch (_) {}
  }

  // --- Commands -----------------------------------------------------------------------------------------------

  void playOrPause() {
    if (ended) {
      ended = false;
      seekTo(0);
      player.play();
      return;
    }
    player.playOrPause();
  }

  /// To a time in the clip (clamped to it).
  void seekTo(double seconds) {
    final s = seconds.clamp(0.0, duration > 0 ? duration : seconds);
    seeking = true;
    _closeSpan();
    _time = clipStart + s;
    if (ended) ended = false;
    player.seek(_dur(clipStart + s));
    _changed();
    // A seek that never lands stops spinning after a while
    Timer(const Duration(seconds: 5), () {
      if (seeking) {
        seeking = false;
        _changed();
      }
    });
  }

  void skip(int seconds) => seekTo(position + seconds);

  void setRate(double r) => player.setRate(r);

  void setVolume(double v) => player.setVolume(v);

  void setSubtitle(SubtitleTrack t) => player.setSubtitleTrack(t);

  void setAudio(AudioTrack t) => player.setAudioTrack(t);

  /// Hardware decoding switched in the Playback options: mpv changes decoder in place.
  void applyHardwareDecoding() => _native?.setProperty('hwdec', _hwdec);

  /// What the statistics overlay shows, read from mpv.
  Future<List<String>> stats() async {
    final native = _native;
    if (native == null) return const ['Opening…'];
    Future<String> get(String p) => native.getProperty(p).catchError((_) => '');
    final codec = await get('video-codec');
    final w = await get('width'), h = await get('height');
    final hw = await get('hwdec-current');
    final cache = await get('demuxer-cache-duration');
    final speed = await get('cache-speed');
    final dropped = await get('frame-drop-count');
    String mb(String bytesPerSecond) =>
        '${((int.tryParse(bytesPerSecond) ?? 0) / 1e6).toStringAsFixed(1)} MB/s';
    return [
      codec.isEmpty
          ? 'Opening…'
          : '${codec.split(' ').first} · ${w}×$h · ${hw.isEmpty || hw == 'no' ? 'software' : 'hardware ($hw)'} decoding',
      'audio ${tracks.audio.where((t) => t.id != 'auto' && t.id != 'no').length} · subtitles ${tracks.subtitle.where((t) => t.id != 'auto' && t.id != 'no').length}',
      'cache ${cache.isEmpty ? '0' : double.tryParse(cache)?.toStringAsFixed(1)} s ahead · ${mb(speed)}',
      if (dropped.isNotEmpty && dropped != '0') 'dropped frames $dropped',
    ];
  }

  void _changed() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _reporter?.cancel();
    if (!ended && duration > 0) _report('paused');
    _unbindToken?.call();
    for (final s in _subs) {
      s.cancel();
    }
    player.dispose();
    super.dispose();
  }
}

Duration _dur(double seconds) =>
    Duration(milliseconds: (seconds * 1000).round());

final _random = Random.secure();

/// A random (v4) UUID: the playback session Cove groups reports by.
String _uuid() {
  final b = List<int>.generate(16, (_) => _random.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final hex = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

/// "1:02 / 12:14 · Ridge line": the moment a time is in (the last one started by then).
cove.Segment? momentAt(
  List<cove.Segment> segments,
  double clipStart,
  double position,
) {
  cove.Segment? current;
  for (final s in segments) {
    if (s.startSec - clipStart <= position) current = s;
  }
  return current;
}
