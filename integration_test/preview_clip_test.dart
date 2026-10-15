import 'dart:async';

import 'package:cove_client/api/cove_client.dart';
import 'package:cove_client/features/library/components/preview_clip.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:media_kit/media_kit.dart';

/// Needs the test server (apps/cove-client/test-server): plays a video's preview clip through media_kit in the real
/// app and waits for its first frame.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  MediaKit.ensureInitialized();

  testWidgets('a preview clip plays', (tester) async {
    final client = await CoveClient.login(
      'http://127.0.0.1:5073',
      'admin',
      'adminadmin',
    );
    final video = (await client.findVideos(1, 1)).items.single;
    final state = Completer<PreviewState>();
    await tester.pumpWidget(
      Directionality(
        textDirection: TextDirection.ltr,
        child: SizedBox(
          width: 320,
          height: 180,
          child: PreviewClip(
            client: client,
            videoId: video.id,
            onState: (s) {
              if (!state.isCompleted) state.complete(s);
            },
          ),
        ),
      ),
    );
    final deadline = DateTime.now().add(const Duration(seconds: 20));
    while (!state.isCompleted && DateTime.now().isBefore(deadline)) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(await state.future, PreviewState.playing);
    client.dispose();
  });
}
