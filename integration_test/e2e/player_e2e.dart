import 'package:cove_client/api/cove_client.dart' hide Video;
import 'package:cove_client/features/player/components/playback_options.dart';
import 'package:cove_client/features/player/components/seek_track.dart';
import 'package:cove_client/features/player/player_screen.dart';
import 'package:cove_client/state/player.dart';
import 'package:cove_client/state/prefs.dart';
import 'package:cove_client/ui/icons.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:media_kit/media_kit.dart' as mk;
import 'package:media_kit_video/media_kit_video.dart' as mk;

import 'harness.dart';

/// The player on a phone (1k, 7c): a card plays, pause and play, skips, the seek track, speed and statistics in the
/// Playback sheet, the controls hiding, full screen, Up next, closing and resuming where it was left.
void playerTests() {
  group('player', () {
    // Light enough for an emulator's decoders: H.264 at 480p, 11 minutes; the one long video its search finds
    const search = 'Elephants Dream', title = 'Elephants Dream 480p';

    mk.PlayerState state(WidgetTester tester) =>
        tester.widget<mk.Video>(find.byType(mk.Video)).controller.player.state;

    Future<void> playing(WidgetTester tester, {double after = 1}) async {
      await waitUntil(
        tester,
        () =>
            find.byType(mk.Video).evaluate().isNotEmpty &&
            state(tester).playing &&
            state(tester).position.inMilliseconds > after * 1000,
        'playback past ${after}s',
        timeout: const Duration(seconds: 40),
      );
      // The picture: mpv decodes the video track. Without a video output (mpv gets no GLES context on the x86_64
      // Android emulator: "Could not create EGL context") it plays the sound alone; a device shows the picture.
      final native = tester.widget<mk.Video>(find.byType(mk.Video)).controller.player.platform as mk.NativePlayer;
      if (await native.getProperty('vo-configured') == 'yes') {
        await waitUntil(tester, () => (state(tester).width ?? 0) > 0, 'the picture');
      } else {
        debugPrint('WARNING: no picture: mpv has no video output on this device (the sound plays)');
      }
    }

    Finder inOptions(Finder f) =>
        find.descendant(of: find.byType(PlaybackOptions), matching: f);

    double position(WidgetTester tester) =>
        state(tester).position.inMilliseconds / 1000;

    /// The Library searched, and a card tapped (the first found when [card] is null): it plays over the Library.
    /// [hideAfterMs]: the controls hide after this long (0: never), set after the launch resets the settings.
    Future<CoveClient> open(
      WidgetTester tester,
      String q, {
      String? card,
      int hideAfterMs = 0,
    }) async {
      final client = await launchSignedIn(tester);
      prefs.set('hideAfterMs', hideAfterMs);
      await type(tester, find.byType(TextField), q);
      final inGrid = find.descendant(
        of: find.byType(GridView),
        matching: card != null ? find.text(card) : find.textContaining(q),
      );
      await waitFor(tester, inGrid);
      await playCard(tester, tester.widget<Text>(inGrid.first).data!);
      // The search's keyboard went down: nothing covers the player
      await waitUntil(
        tester,
        () => tester.view.viewInsets.bottom == 0,
        'the keyboard down',
        timeout: const Duration(seconds: 3),
      );
      await playing(tester);
      return client;
    }

    testWidgets('play, pause, skip, seek, speed, statistics; close and resume', (
      tester,
    ) async {
      // The controls stay up (they hide in the next test)
      final client = await open(tester, search, card: title);
      final video = player.playing!.video;
      expect(
        find.descendant(of: find.byType(PlayerScreen), matching: find.text(title)),
        findsWidgets,
      );

      // Pause, play
      await tap(tester, label('Pause'));
      await waitUntil(tester, () => !state(tester).playing, 'paused');
      expect(label('Play'), findsOneWidget);
      await tap(tester, label('Play'));
      await playing(tester);

      // Forward and back by the skip step (10 s)
      var at = position(tester);
      await tap(tester, label('Forward 10 seconds'));
      await waitUntil(tester, () => position(tester) >= at + 8, 'forward 10 s');
      at = position(tester);
      await tap(tester, label('Back 10 seconds'));
      await waitUntil(tester, () => position(tester) <= at - 8, 'back 10 s');

      // The seek track: a tap at its middle goes to the middle
      final duration = state(tester).duration.inMilliseconds / 1000;
      final track = find.byType(SeekTrack);
      await tester.tap(track);
      await waitUntil(
        tester,
        () => (position(tester) - duration / 2).abs() < duration * 0.1,
        'the middle of the video',
      );

      // The Playback sheet: speed
      await tap(tester, label('Playback'));
      await waitFor(tester, inOptions(find.text('SPEED')));
      await tap(tester, inOptions(find.text('1.5×')));
      await waitUntil(tester, () => state(tester).rate == 1.5, 'speed 1.5×');
      if (find.byType(PlaybackOptions).evaluate().isEmpty) {
        await tap(tester, label('Playback'));
      }
      await tap(tester, inOptions(find.text('1×')));
      await waitUntil(tester, () => state(tester).rate == 1, 'speed 1×');

      // Statistics: the overlay says how it decodes
      if (find.byType(PlaybackOptions).evaluate().isEmpty) {
        await tap(tester, label('Playback'));
      }
      await tap(tester, inOptions(find.text('Playback statistics')));
      expect(prefs.stats, isTrue);
      // The overlay: "h264 · 480×270 · software decoding" (or "Opening…" without a video output), then always
      // "audio 1 · subtitles 0"
      final overlay = find.textContaining(RegExp(r'audio \d+ · subtitles \d+'));
      await waitFor(tester, overlay, timeout: const Duration(seconds: 5));
      await tap(tester, inOptions(find.text('Playback statistics')));
      expect(prefs.stats, isFalse);
      await tester.tapAt(const Offset(20, 20));
      await settle(tester);
      await waitGone(tester, find.byType(PlaybackOptions));
      expect(overlay, findsNothing);

      // Close: Cove keeps where it was left
      final left = position(tester);
      await closePlayer(tester);
      expect(player.playing, isNull);
      await settle(tester, 1500);
      final resume = (await client.engagement([video.id]))[video.id]!.resumeTime;
      expect(resume, closeTo(left, 15));

      // Opened again, it resumes there
      await playCard(tester, title);
      await playing(tester, after: resume - 5);
      expect(position(tester), greaterThan(resume - 5));
      await closePlayer(tester);
    });

    testWidgets('the controls hide while it plays, and a tap brings them back', (
      tester,
    ) async {
      await open(tester, search, card: title, hideAfterMs: 2000);
      // The controls' fade (the full screen button's, always there in them)
      double shown() => tester
          .widget<AnimatedOpacity>(
            find
                .ancestor(
                  of: find.byIcon(Phosphor.cornersOut),
                  matching: find.byType(AnimatedOpacity),
                )
                .first,
          )
          .opacity;
      expect(shown(), 1);
      await waitUntil(tester, () => shown() == 0, 'the controls hidden');
      expect(state(tester).playing, isTrue);

      // A tap on the video's middle shows them; the button pauses
      await tester.tapAt(tester.getCenter(find.byType(mk.Video)));
      await waitUntil(tester, () => shown() == 1, 'the controls shown');
      await tap(tester, label('Pause'));
      await waitUntil(tester, () => !state(tester).playing, 'paused');
      // Paused, they stay
      await settle(tester, 2500);
      expect(shown(), 1);
      await closePlayer(tester);
    });

    testWidgets('full screen, and Up next', (tester) async {
      // Two long videos: the first card's Up next is the other
      await open(tester, 'Tears of Steel');
      final first = player.playing!;
      expect(first.upNext, isNotEmpty);

      await tap(tester, label('Full screen'), settleMs: 1500);
      await waitFor(tester, label('Leave full screen'));
      await playing(tester);
      await tap(tester, label('Leave full screen'), settleMs: 1500);
      await waitFor(tester, label('Full screen'));

      // Up next: the Library's videos after this one; a row plays it
      if (first.upNext.isNotEmpty) {
        final row = find.byWidgetPredicate((w) => w.runtimeType.toString() == '_UpNextRow');
        if (tablet) {
          // A tab of the side panel (1m)
          await tap(tester, label('Up next'));
        } else {
          await tester.scrollUntilVisible(
            row.first,
            200,
            scrollable: find
                .descendant(of: find.byType(PlayerScreen), matching: find.byType(Scrollable))
                .first,
          );
        }
        await tap(tester, row.first);
        await waitUntil(
          tester,
          () => player.playing?.video.id == first.upNext.first.id,
          'the next video',
        );
        await playing(tester);
      } else {
        expect(find.text('Nothing after this video.'), findsOneWidget);
      }
      await closePlayer(tester);
    });
  });
}
