import 'dart:math';
import 'dart:ui' show FrameTiming;

import 'package:cove_client/api/cove_client.dart';
import 'package:cove_client/data/library.dart';
import 'package:cove_client/features/library/library_screen.dart';
import 'package:cove_client/features/player/player_session.dart';
import 'package:cove_client/state/prefs.dart';
import 'package:cove_client/ui/icons.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart' as mk;

/// Performance on a device, against the test server (adb reverse tcp:5073 tcp:5073): flinging through the Library's
/// grid (frame build and raster times), and a 4K video playing (mpv's dropped and delayed frames).
/// flutter drive --profile --driver=test_driver/perf_driver.dart --target=integration_test/perf_test.dart -d <device>
const server = String.fromEnvironment(
  'SERVER',
  defaultValue: 'http://localhost:5073',
);

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  MediaKit.ensureInitialized();

  // The list is fine now (release build, one clip per card): skipped so runs measure playback only
  testWidgets('scrolling the Library', skip: true, (tester) async {
    final client = await CoveClient.login(server, 'admin', 'adminadmin');
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: LibraryScreen(client: client)),
      ),
    );
    for (var i = 0; i < 40; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    final grid = find.byType(GridView);
    expect(grid, findsOneWidget);
    await binding.watchPerformance(() async {
      for (var i = 0; i < 6; i++) {
        await tester.fling(grid, const Offset(0, -900), 3000);
        await tester.pumpAndSettle();
      }
      for (var i = 0; i < 6; i++) {
        await tester.fling(grid, const Offset(0, 900), 3000);
        await tester.pumpAndSettle();
      }
    }, reportKey: 'library_scroll');
    client.dispose();
  });

  testWidgets('switching views', (tester) async {
    final client = await CoveClient.login(server, 'admin', 'adminadmin');
    prefs.libraryView = LibraryView.grid3;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: LibraryScreen(client: client)),
      ),
    );
    for (var i = 0; i < 40; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    await tester.fling(find.byType(GridView), const Offset(0, -700), 2000);
    await tester.pumpAndSettle();
    // Frames as the app gets them, through each move
    binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;
    final shown = <FrameTiming>[];
    void collect(List<FrameTiming> t) => shown.addAll(t);
    WidgetsBinding.instance.addTimingsCallback(collect);
    await binding.watchPerformance(() async {
      for (final icon in [
        Phosphor.squaresFour,
        Phosphor.rows,
        Phosphor.dotsNine,
        Phosphor.rows,
        Phosphor.squaresFour,
        Phosphor.dotsNine,
      ]) {
        await tester.tap(find.byIcon(icon));
        await Future<void>.delayed(const Duration(milliseconds: 900));
      }
    }, reportKey: 'view_switch');
    WidgetsBinding.instance.removeTimingsCallback(collect);
    binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fadePointers;
    final over = shown.where((t) => t.totalSpan.inMicroseconds > 16700).length;
    final worst = shown
        .map((t) => t.totalSpan.inMicroseconds / 1000)
        .fold(0.0, max);
    binding.reportData = {
      ...?binding.reportData,
      'view_switch_frames': {
        'count': shown.length,
        'over_16ms': over,
        'worst_ms': worst,
      },
    };
    debugPrint(
      'views: ${shown.length} frames, $over over 16.7 ms, worst ${worst.toStringAsFixed(1)} ms',
    );
    client.dispose();
  });

  testWidgets('playing 4K', (tester) async {
    final client = await CoveClient.login(server, 'admin', 'adminadmin');
    final videos = (await client.findVideos(1, 200)).items;
    final video = videos.firstWhere(
      (v) => videoName(v).contains('Big Buck Bunny 2160p60'),
    );
    final session = PlayerSession(
      client: client,
      personal: PersonalStore(client),
      video: video,
      startAt: 60,
      onEnded: () {},
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Center(
            child: AspectRatio(
              aspectRatio: 16 / 9,
              child: mk.Video(
                controller: session.controller,
                controls: mk.NoVideoControls,
              ),
            ),
          ),
        ),
      ),
    );
    final deadline = DateTime.now().add(const Duration(seconds: 30));
    while (!(session.playing && session.position > 61)) {
      if (DateTime.now().isAfter(deadline))
        fail('4K did not start: ${session.error}');
      await tester.pump(const Duration(milliseconds: 200));
    }
    final stats = <String, String>{};
    Future<String> prop(String p) =>
        (session.player.platform as NativePlayer).getProperty(p);
    final dropped0 = int.tryParse(await prop('frame-drop-count')) ?? 0;
    final decoderDropped0 =
        int.tryParse(await prop('decoder-frame-drop-count')) ?? 0;
    final delayed0 = int.tryParse(await prop('vo-delayed-frame-count')) ?? 0;
    final start = session.position;
    // Frames as the app gets them: every new video frame asks for one
    binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;
    final shown = <FrameTiming>[];
    void collect(List<FrameTiming> t) => shown.addAll(t);
    WidgetsBinding.instance.addTimingsCallback(collect);
    await binding.watchPerformance(() async {
      await Future<void>.delayed(const Duration(seconds: 15));
    }, reportKey: 'player_4k_ui');
    WidgetsBinding.instance.removeTimingsCallback(collect);
    stats['flutter_fps'] = (shown.length / 15).toStringAsFixed(1);
    stats['flutter_frames_over_16ms'] =
        '${shown.where((t) => t.totalSpan.inMicroseconds > 16700).length}';
    stats['played_seconds'] = (session.position - start).toStringAsFixed(1);
    binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fadePointers;
    stats['frame_drop'] =
        '${(int.tryParse(await prop('frame-drop-count')) ?? 0) - dropped0}';
    stats['decoder_frame_drop'] =
        '${(int.tryParse(await prop('decoder-frame-drop-count')) ?? 0) - decoderDropped0}';
    stats['vo_delayed'] =
        '${(int.tryParse(await prop('vo-delayed-frame-count')) ?? 0) - delayed0}';
    stats['hwdec_current'] = await prop('hwdec-current');
    stats['estimated_vf_fps'] = await prop('estimated-vf-fps');
    stats['container_fps'] = await prop('container-fps');
    stats['dwidth'] = '${await prop('dwidth')}x${await prop('dheight')}';
    stats['vf'] = await prop('vf');
    stats['screen'] = '${tester.view.physicalSize}';
    stats['osd'] = '${await prop('osd-width')}x${await prop('osd-height')}';
    binding.reportData = {...?binding.reportData, 'player_4k': stats};
    debugPrint('4K: $stats');
    session.dispose();
    client.dispose();
  });
}

String videoName(Video v) => v.title ?? v.primaryFile?.basename ?? '';
