import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../e2e/harness.dart' show settle, waitUntil;
import 'stress_harness.dart';

// A test's own limit; a call that hangs fails sooner (bounded, 30 s)
const _long = Timeout(Duration(minutes: 6));

/// Trying to break the player (media_kit, libmpv, MediaCodec): seek storms on hardware- and software-decoded video,
/// views resized and removed mid-seek, the screen rotating, video after video, players opened and disposed at once,
/// several at a time, decoders and tracks switched while seeking, a file it can't decode. Each ends with the player
/// playing on (the clock and, where there is a picture, the frames moving); an error thrown anywhere fails the test.
void stressTests() {
  group('stress', () {
    setUpAll(() async {
      await library();
      debugPrint('STRESS seed $seed, rounds $rounds (--dart-define=SEED=$seed repeats this run)');
    });

    tearDown(() => SystemChrome.setPreferredOrientations([]));

    testWidgets('seek storms: hardware and software decoding', timeout: _long, (tester) async {
      for (final clip in [h264, hevc, h264sw, mpeg2, theora, xvid, wmv2]) {
        final p = StressPlayer(clip);
        await show(tester, [p], size: const Size(400, 225));
        await p.open(clip);
        await started(tester, p);
        await seekStorm(tester, p, count: 30);
        await expectHealthy(tester, p, 'seek storm');
        await show(tester, []);
        await p.dispose();
      }
    });

    testWidgets('4K: seek storm', timeout: _long, (tester) async {
      for (final clip in [h264uhd, hevcUhd]) {
        final p = StressPlayer(clip);
        await show(tester, [p], size: const Size(480, 270));
        await p.open(clip);
        await started(tester, p);
        await seekStorm(tester, p, count: 30);
        await expectHealthy(tester, p, '4K seek storm');
        await show(tester, []);
        await p.dispose();
      }
    });

    testWidgets('the view resized and removed while seeking', timeout: _long, (tester) async {
      for (final clip in [h264, mpeg2]) {
        final p = StressPlayer(clip);
        await show(tester, [p]);
        await p.open(clip);
        await started(tester, p);
        const sizes = [Size(160, 90), Size(400, 225), Size(320, 180), Size(640, 360), Size(90, 160)];
        for (var i = 0; i < 30 * rounds; i++) {
          unawaited(p.player.seek(p.somewhere()));
          // Every few: gone for a moment (its surface released, a new one after), else another size
          await show(tester, [p], size: sizes[i % sizes.length], visible: i % 4 != 3);
          await tester.pump(Duration(milliseconds: random.nextInt(120)));
        }
        await show(tester, [p], size: const Size(400, 225));
        await expectHealthy(tester, p, 'resized and removed while seeking');
        await show(tester, []);
        await p.dispose();
      }
    });

    testWidgets('the screen rotating while it plays and seeks', timeout: _long, (tester) async {
      final p = StressPlayer(h264);
      await show(tester, [p], size: const Size(400, 225));
      await p.open(h264);
      await started(tester, p);
      const turns = [
        [DeviceOrientation.landscapeLeft],
        [DeviceOrientation.portraitUp],
        [DeviceOrientation.landscapeRight],
        [DeviceOrientation.portraitUp],
      ];
      for (var i = 0; i < 8 * rounds; i++) {
        await SystemChrome.setPreferredOrientations(turns[i % turns.length]);
        if (i.isEven) await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
        if (i.isOdd) await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
        // Seeks while the surface comes and goes with the rotation
        for (var j = 0; j < 4; j++) {
          unawaited(p.player.seek(p.somewhere()));
          await tester.pump(Duration(milliseconds: 100 + random.nextInt(250)));
        }
        await settle(tester, 300 + random.nextInt(900));
      }
      await SystemChrome.setPreferredOrientations([]);
      await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
      await settle(tester, 1500);
      await expectHealthy(tester, p, 'screen rotating');
      await show(tester, []);
      await p.dispose();
    });

    testWidgets('video after video, seeking as each opens', timeout: _long, (tester) async {
      final playlist = [h264, mpeg2, hevc, theora, subs, xvid, h264uhd, wmv2];
      final p = StressPlayer(h264);
      await show(tester, [p], size: const Size(400, 225));
      for (var i = 0; i < 16 * rounds; i++) {
        final clip = playlist[i % playlist.length];
        await p.open(clip);
        // Before it has even loaded, and again just after
        unawaited(p.player.seek(Duration(seconds: 2 + random.nextInt(8))));
        await tester.pump(Duration(milliseconds: random.nextInt(300)));
        unawaited(p.player.seek(p.somewhere()));
        await settle(tester, 200 + random.nextInt(1200));
        if (i % 4 == 3) await expectHealthy(tester, p, 'video after video #$i');
      }
      await expectHealthy(tester, p, 'video after video');
      await show(tester, []);
      await p.dispose();
    });

    testWidgets('players opened, seeked and disposed at once', timeout: _long, (tester) async {
      final clips = [h264, mpeg2, hevc, theora];
      for (var i = 0; i < 24 * rounds; i++) {
        final p = StressPlayer(clips[i % clips.length]);
        await show(tester, [p]);
        final opening = p.open(p.clip);
        // Disposed at any point: before the file opens, while it opens, while it seeks, while it plays
        await tester.pump(Duration(milliseconds: random.nextInt(800)));
        if (random.nextBool()) unawaited(p.player.seek(Duration(seconds: 1 + random.nextInt(5))));
        await tester.pump(Duration(milliseconds: random.nextInt(300)));
        if (random.nextBool()) await show(tester, []);
        await p.dispose();
        await opening.catchError((Object _) {});
        await show(tester, []);
      }
      // After all that, a new one works
      final p = StressPlayer(h264);
      await show(tester, [p], size: const Size(400, 225));
      await p.open(h264);
      await started(tester, p);
      await expectHealthy(tester, p, 'after the churn');
      await show(tester, []);
      await p.dispose();
    });

    testWidgets('four players at once, all seeking', timeout: _long, (tester) async {
      final ps = [StressPlayer(h264), StressPlayer(hevc), StressPlayer(mpeg2), StressPlayer(theora)];
      await show(tester, ps, size: const Size(200, 112));
      for (final p in ps) {
        await p.open(p.clip);
      }
      for (final p in ps) {
        await started(tester, p);
      }
      await withFrames(tester, Future.wait([for (final p in ps) seekStorm(tester, p, count: 15, pump: false)]));
      for (final p in ps) {
        await expectHealthy(tester, p, 'four at once');
      }
      await show(tester, []);
      for (final p in ps) {
        await p.dispose();
      }
    });

    testWidgets('the decoder switched while seeking', timeout: _long, (tester) async {
      final p = StressPlayer(h264);
      await show(tester, [p], size: const Size(400, 225));
      await p.open(h264);
      await started(tester, p);
      final decoders = [hw, 'mediacodec-copy', sw, hw, sw, 'mediacodec-copy'];
      for (var i = 0; i < 12 * rounds; i++) {
        unawaited(p.native.setProperty('hwdec', decoders[i % decoders.length]));
        unawaited(p.player.seek(p.somewhere()));
        await settle(tester, 200 + random.nextInt(800));
      }
      await p.native.setProperty('hwdec', hw);
      await expectHealthy(tester, p, 'decoder switched while seeking');
      await show(tester, []);
      await p.dispose();
    });

    testWidgets('tracks switched while seeking', timeout: _long, (tester) async {
      for (final clip in [subs, tracks]) {
        final p = StressPlayer(clip);
        await show(tester, [p], size: const Size(400, 225));
        await p.open(clip);
        await started(tester, p);
        await waitUntil(tester, () => p.player.state.tracks.audio.length > 2, 'the tracks of ${clip.file}');
        final audio = p.player.state.tracks.audio;
        final subtitles = p.player.state.tracks.subtitle;
        for (var i = 0; i < 20 * rounds; i++) {
          final Future<void> op = switch (i % 3) {
            0 => p.player.setAudioTrack(audio[random.nextInt(audio.length)]),
            1 => p.player.setSubtitleTrack(subtitles[random.nextInt(subtitles.length)]),
            _ => p.player.seek(p.somewhere()),
          };
          unawaited(op);
          await tester.pump(Duration(milliseconds: random.nextInt(250)));
        }
        await expectHealthy(tester, p, 'tracks switched while seeking');
        await show(tester, []);
        await p.dispose();
      }
    });

    testWidgets('a file it cannot decode, then one it can', timeout: _long, (tester) async {
      final p = StressPlayer(prores);
      await show(tester, [p], size: const Size(400, 225));
      await p.open(prores);
      for (var i = 0; i < 6; i++) {
        unawaited(p.player.seek(Duration(seconds: i * 2)));
        await settle(tester, 300);
      }
      await settle(tester, 2000);
      debugPrint('STRESS prores: codec "${await p.prop('video-codec')}", errors ${p.errors}');
      // The same player goes on to a file it can play
      await p.open(h264);
      await started(tester, p);
      await expectHealthy(tester, p, 'after a file it cannot decode');
      await show(tester, []);
      await p.dispose();
    });
    testWidgets('libmpv destroyed mid-operation, the app never blocked', timeout: _long, (tester) async {
      // Every way a player can go while it is busy; through all of them the main isolate keeps running (mpv's destroy
      // waits for its core thread: on the main isolate a slow one froze the app, Android's "not responding")
      final cases = <String, Future<void> Function(StressPlayer p)>{
        'mid-seek storm': (p) async {
          for (var i = 0; i < 12; i++) {
            unawaited(p.player.seek(p.somewhere()).catchError((Object _) {}));
          }
          await tester.pump(Duration(milliseconds: random.nextInt(60)));
        },
        'just opened': (p) async {},
        'mid-rotation': (p) async {
          await SystemChrome.setPreferredOrientations(
            [random.nextBool() ? DeviceOrientation.landscapeLeft : DeviceOrientation.portraitUp],
          );
          unawaited(p.player.seek(p.somewhere()).catchError((Object _) {}));
          await tester.pump(Duration(milliseconds: random.nextInt(400)));
        },
        'mid-decoder switch': (p) async {
          unawaited(p.native.setProperty('hwdec', random.nextBool() ? sw : 'mediacodec-copy').catchError((Object _) {}));
          unawaited(p.player.seek(p.somewhere()).catchError((Object _) {}));
          await tester.pump(Duration(milliseconds: random.nextInt(100)));
        },
        'its view removed in the same frame': (p) async {
          unawaited(p.player.seek(p.somewhere()).catchError((Object _) {}));
          await show(tester, []);
        },
        'paused mid-seek': (p) async {
          await p.player.pause();
          unawaited(p.player.seek(p.somewhere()).catchError((Object _) {}));
        },
      };
      final clips = [h264, hevc, mpeg2, h264uhd];
      var worst = Duration.zero;
      for (var round = 0; round < 3 * rounds; round++) {
        for (final MapEntry(key: name, value: before) in cases.entries) {
          final clip = clips[random.nextInt(clips.length)];
          final p = StressPlayer(clip);
          await show(tester, [p]);
          await p.open(clip);
          // Playing for a moment, or not even that
          if (name != 'just opened') await settle(tester, random.nextInt(1500));
          final pause = await longestPause(() async {
            await before(p);
            await p.dispose();
          });
          if (pause > worst) worst = pause;
          expect(pause, lessThan(const Duration(seconds: 2)), reason: 'disposed $name (${clip.note}): the app stood still');
          await show(tester, []);
          await SystemChrome.setPreferredOrientations([]);
        }
      }

      // Six at once, all mid-seek
      final six = [for (final c in [h264, hevc, mpeg2, theora, xvid, h264uhd]) StressPlayer(c)];
      await show(tester, six, size: const Size(160, 90));
      for (final p in six) {
        await p.open(p.clip);
      }
      await settle(tester, 1500);
      final together = await longestPause(() async {
        for (final p in six) {
          for (var i = 0; i < 5; i++) {
            unawaited(p.player.seek(p.somewhere()).catchError((Object _) {}));
          }
        }
        await Future.wait([for (final p in six) p.dispose()]);
      });
      expect(together, lessThan(const Duration(seconds: 2)), reason: 'six disposed at once: the app stood still');
      await show(tester, []);

      // Disposed and made again on the same file, over and over
      for (var i = 0; i < 10 * rounds; i++) {
        final p = StressPlayer(h264);
        await show(tester, [p]);
        await p.open(h264);
        unawaited(p.player.seek(p.somewhere()).catchError((Object _) {}));
        await tester.pump(Duration(milliseconds: random.nextInt(250)));
        final pause = await longestPause(p.dispose);
        expect(pause, lessThan(const Duration(seconds: 2)), reason: 'made and disposed #$i: the app stood still');
      }
      await show(tester, []);
      debugPrint('STRESS destroyed mid-operation: the longest pause one at a time ${worst.inMilliseconds} ms, '
          'six at once ${together.inMilliseconds} ms');

      // And a player made after all of it plays
      final p = StressPlayer(h264);
      await show(tester, [p], size: const Size(400, 225));
      await p.open(h264);
      await started(tester, p);
      await expectHealthy(tester, p, 'after the destroying');
      await show(tester, []);
      await p.dispose();
    });
  });
}

