import 'package:cove_client/api/cove_client.dart';
import 'package:cove_client/data/library.dart';
import 'package:cove_client/features/player/player_session.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart' as mk;

/// Needs the test server (apps/cove-client/test-server): plays a video in the real app, seeks, closes, and checks
/// that Cove kept where it was left (the player's reports).
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  MediaKit.ensureInitialized();

  testWidgets('a video plays, seeks and reports where it was left', (
    tester,
  ) async {
    final client = await CoveClient.login(
      'http://127.0.0.1:5073',
      'admin',
      'adminadmin',
    );
    // A 1080p H.264 clip of a few minutes: "Tears of Steel" 720p is h264 too
    final page = await client.findVideos(1, 200);
    final video = page.items.firstWhere(
      (v) =>
          (v.primaryFile?.videoCodec == 'h264') &&
          (v.primaryFile?.duration ?? 0) > 120,
    );
    final personal = PersonalStore(client);
    final session = PlayerSession(
      client: client,
      personal: personal,
      video: video,
      startAt: 30,
      onEnded: () {},
    );
    await tester.pumpWidget(
      Directionality(
        textDirection: TextDirection.ltr,
        child: SizedBox(
          width: 640,
          height: 360,
          child: mk.Video(
            controller: session.controller,
            controls: mk.NoVideoControls,
          ),
        ),
      ),
    );
    Future<void> until(bool Function() done, String what) async {
      final deadline = DateTime.now().add(const Duration(seconds: 30));
      while (!done()) {
        if (DateTime.now().isAfter(deadline))
          fail('timed out waiting for $what');
        await tester.pump(const Duration(milliseconds: 200));
      }
    }

    await until(
      () => session.loaded && session.playing && session.position > 31,
      'playback from the moment',
    );
    expect(session.error, isEmpty);
    session.seekTo(90);
    await until(() => session.position > 91, 'the seek');
    session.player.pause();
    await until(() => !session.playing, 'pause');
    await tester.pump(const Duration(seconds: 2));
    final engagement = (await client.engagement([video.id]))[video.id]!;
    debugPrint('resumeTime after the pause: ${engagement.resumeTime}');
    expect(engagement.resumeTime, greaterThan(85));
    session.dispose();
    await tester.pumpWidget(const SizedBox());
    client.dispose();
  });
}
