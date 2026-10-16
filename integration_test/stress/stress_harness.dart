import 'dart:async';
import 'dart:io' show Platform;
import 'dart:math';

import 'package:cove_client/api/cove_client.dart' hide Video;
import 'package:cove_client/api/models.dart' as cove;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart';

import '../e2e/harness.dart' show login, settle, waitUntil;

/// How hard: rounds multiply every storm (--dart-define=STRESS=3). SEED repeats a run's random choices.
const rounds = int.fromEnvironment('STRESS', defaultValue: 1);

/// mpv's log, printed as it comes (warnings; --dart-define=MPVLOG=v for everything): where a player stalls.
const mpvLog = String.fromEnvironment('MPVLOG', defaultValue: 'warn');
var _players = 0;
final seed = const int.fromEnvironment('SEED', defaultValue: 0) != 0
    ? const int.fromEnvironment('SEED')
    : DateTime.now().millisecondsSinceEpoch % 100000;
final random = Random(seed);

/// Hardware decoding as the app does it on Android (zero-copy MediaCodec), or software.
String get hw => Platform.isAndroid ? 'mediacodec' : 'auto-safe';
const sw = 'no';

/// The test library's files these storms play (test-server/: media.txt, make-exotic.sh).
class Clip {
  const Clip(this.file, this.hwdec, this.note);
  final String file;
  final String hwdec;
  final String note;
}

final h264 = Clip('Big Buck Bunny 1080p60.mp4', hw, 'H.264 1080p60, hardware');
final h264uhd = Clip('Big Buck Bunny 2160p60.mp4', hw, 'H.264 4K60, hardware');
final hevc = Clip('PhotoJoseph AV Sync 59.94fps 1080p HEVC.mov', hw, 'HEVC 1080p, hardware');
final hevcUhd = Clip('PhotoJoseph AV Sync 59.94fps 2160p HEVC.mov', hw, 'HEVC 4K, hardware');
final h264sw = Clip('Big Buck Bunny 1080p60.mp4', sw, 'H.264 1080p60, software');
final mpeg2 = Clip('Exotic MPEG-2 interlaced.ts', hw, 'MPEG-2 interlaced (software: no MediaCodec)');
final theora = Clip('Exotic Theora.ogv', hw, 'Theora (software)');
final xvid = Clip('Exotic MPEG-4 ASP Xvid.avi', hw, 'MPEG-4 ASP (MediaCodec or software)');
final wmv2 = Clip('Exotic WMV2.wmv', hw, 'WMV2 (software)');
final subs = Clip('Tears of Steel 720p (embedded subs).mkv', hw, 'H.264 with subtitle tracks');
final tracks = Clip('Exotic Tracks and Subtitles.mkv', hw, 'two audio, two subtitle tracks');
final prores = Clip('Exotic ProRes 422.mov', hw, 'ProRes (no decoder in this FFmpeg)');

/// A call into the player that must come back: a hang fails here, named, within [limit] (not at the test's timeout).
Future<T> bounded<T>(Future<T> call, String what, {Duration limit = const Duration(seconds: 30)}) =>
    call.timeout(limit, onTimeout: () => fail('HANG: $what did not return in ${limit.inSeconds} s'));

CoveClient? _client;
Map<String, cove.Video>? _videos;

/// The test server's videos by file name (one sign-in for the run).
Future<CoveClient> library() async {
  final client = _client ??= await login();
  _videos ??= {
    for (final v in (await client.findVideos(1, 1000)).items)
      if (v.primaryFile != null) v.primaryFile!.basename: v,
  };
  return client;
}

Media media(Clip clip) {
  final video = _videos![clip.file];
  if (video == null) fail('${clip.file} is not in the test library (test-server/)');
  return Media(_client!.streamUrl(video), httpHeaders: _client!.authHeaders);
}

/// A player as the app makes one (media_kit, the app's decoder), with what mpv complains about collected.
class StressPlayer {
  StressPlayer(this.clip, {String? hwdec})
    : player = Player(
        configuration: const PlayerConfiguration(
          logLevel: mpvLog == 'v' ? MPVLogLevel.v : MPVLogLevel.warn,
          bufferSize: 32 * 1024 * 1024,
        ),
      ),
      id = ++_players {
    final decoder = hwdec ?? clip.hwdec;
    controller = VideoController(
      player,
      configuration: VideoControllerConfiguration(
        hwdec: decoder,
        enableHardwareAcceleration: decoder != sw,
      ),
    );
    _subs.add(
      player.stream.log.listen((l) {
        debugPrint('mpv#$id [${l.prefix}] ${l.level}: ${l.text.trim()}');
        if (l.level == 'error' || l.level == 'fatal' || l.text.contains('timed out')) {
          problems.add('[${l.prefix}] ${l.text.trim()}');
        }
      }),
    );
    _subs.add(player.stream.error.listen(errors.add));
  }

  Clip clip;
  final int id;
  final Player player;
  late final VideoController controller;
  final problems = <String>[];
  final errors = <String>[];
  final _subs = <StreamSubscription<Object?>>[];
  bool disposed = false;

  NativePlayer get native => player.platform as NativePlayer;

  Future<String> prop(String name) =>
      bounded(native.getProperty(name), '${clip.note}: getProperty($name)').catchError((Object e) {
        if ('$e'.contains('HANG')) throw e;
        return '';
      });

  Future<void> open(Clip next) async {
    clip = next;
    await bounded(player.open(media(next)), '${next.note}: open');
  }

  /// The file's length in seconds (0 until it is known).
  double get duration => player.state.duration.inMilliseconds / 1000;

  /// A random position, away from the end (so that playing on from it doesn't end the file).
  Duration somewhere() {
    final d = duration > 0 ? duration : 10;
    return Duration(milliseconds: (random.nextDouble() * max(1, d - 6) * 1000).round());
  }

  Future<void> dispose() async {
    if (disposed) return;
    disposed = true;
    for (final s in _subs) {
      await s.cancel();
    }
    await bounded(player.dispose(), '${clip.note}: dispose');
  }

  /// What mpv said, summed up (the aimagereader hang said "Waiting for frame timed out").
  String summary() {
    final counts = <String, int>{};
    for (final p in problems) {
      final key = p.length > 90 ? p.substring(0, 90) : p;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts.entries.map((e) => '${e.value}x ${e.key}').join('\n    ');
  }
}

/// The players on screen, each in a box of [size] (null: not shown, so its surface goes).
Future<void> show(
  WidgetTester tester,
  List<StressPlayer> players, {
  Size size = const Size(320, 180),
  bool visible = true,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        backgroundColor: Colors.black,
        body: Wrap(
          children: [
            for (final p in players)
              if (visible && !p.disposed)
                SizedBox(
                  width: size.width,
                  height: size.height,
                  child: Video(controller: p.controller, controls: NoVideoControls),
                ),
          ],
        ),
      ),
    ),
  );
  await tester.pump();
}

/// Plays until it is playing past its start.
Future<void> started(WidgetTester tester, StressPlayer p) => waitUntil(
  tester,
  () => p.player.state.playing && p.player.state.position.inMilliseconds > 300,
  '${p.clip.note}: playback',
  timeout: const Duration(seconds: 40),
);

/// Recovered: it plays on from somewhere in the middle, the clock moves, and the picture too where there is one (an
/// emulator gives mpv no video output). A hang shows here as a clock or a picture that stops.
Future<void> expectHealthy(WidgetTester tester, StressPlayer p, String what) async {
  await bounded(
    p.player.seek(Duration(milliseconds: (max(1.0, p.duration * 0.3) * 1000).round())),
    '$what (${p.clip.note}): seek',
  );
  if (!p.player.state.playing) await bounded(p.player.play(), '$what (${p.clip.note}): play');
  await settle(tester, 500);
  final hasPicture = await p.prop('vo-configured') == 'yes';
  final f0 = int.tryParse(await p.prop('estimated-frame-number')) ?? 0;
  final t0 = p.player.state.position;
  await waitUntil(
    tester,
    () => (p.player.state.position - t0).inMilliseconds >= 1500,
    '$what (${p.clip.note}): the clock moving on after the storm',
    timeout: const Duration(seconds: 20),
  );
  final f1 = int.tryParse(await p.prop('estimated-frame-number')) ?? 0;
  if (hasPicture) {
    expect(
      f1 - f0,
      greaterThan(10),
      reason: '$what (${p.clip.note}): frames after the storm (${await p.prop('hwdec-current')})',
    );
  }
  debugPrint(
    'STRESS ok: $what | ${p.clip.note} | hwdec ${await p.prop('hwdec-current')} | '
    '${hasPicture ? '${f1 - f0} frames' : 'no video output'}'
    '${p.problems.isEmpty ? '' : '\n    ${p.summary()}'}',
  );
}

/// Seeks every which way: absolute and relative, awaited or not, with play/pause and speed changes in between.
/// Storms run side by side wait with timers ([pump] false; tester.pump is one at a time) and one loop pumps frames.
Future<void> seekStorm(WidgetTester tester, StressPlayer p, {int count = 25, bool pump = true}) async {
  for (var i = 0; i < count * rounds; i++) {
    final roll = random.nextInt(10);
    final Future<void> op = switch (roll) {
      0 => p.player.playOrPause(),
      1 => p.player.setRate([0.5, 1.0, 1.5, 2.0][random.nextInt(4)]),
      2 || 3 => p.player.seek(
        p.player.state.position + Duration(seconds: random.nextBool() ? 10 : -10),
      ),
      _ => p.player.seek(p.somewhere()),
    };
    // Half of them not waited for: the next one comes while this one is on its way
    if (random.nextBool()) {
      await bounded(op, '${p.clip.note}: seek storm #$i');
    } else {
      unawaited(op);
    }
    final gap = Duration(milliseconds: random.nextInt(150));
    pump ? await tester.pump(gap) : await Future<void>.delayed(gap);
  }
  await bounded(p.player.setRate(1.0), '${p.clip.note}: setRate');
}

/// The main isolate's longest pause while [body] runs: a ticker every 10 ms, and the largest gap between its ticks. A
/// dispose that blocks (mpv's destroy waits for its core thread) shows as a long gap; Android calls the app not
/// responding after 5 s.
Future<Duration> longestPause(Future<void> Function() body) async {
  final clock = Stopwatch()..start();
  var last = Duration.zero, longest = Duration.zero;
  final ticker = Timer.periodic(const Duration(milliseconds: 10), (_) {
    final now = clock.elapsed;
    if (now - last > longest) longest = now - last;
    last = now;
  });
  try {
    await body();
  } finally {
    ticker.cancel();
  }
  final tail = clock.elapsed - last;
  return tail > longest ? tail : longest;
}

/// Runs [body] while frames keep being pumped (for work that can't call tester.pump itself).
Future<void> withFrames(WidgetTester tester, Future<void> body) async {
  var done = false;
  final work = body.whenComplete(() => done = true);
  while (!done) {
    await tester.pump(const Duration(milliseconds: 16));
  }
  await work;
}
