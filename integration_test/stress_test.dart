import 'package:integration_test/integration_test.dart';
import 'package:media_kit/media_kit.dart';

import 'stress/stress_scenarios.dart';

/// Stress: trying to break the player (media_kit, libmpv, MediaCodec), against the test server (test-server/). It
/// plays through media_kit directly, as the app does, and leaves the app's own data alone (servers, settings).
/// `flutter test integration_test/stress_test.dart -d emulator-5554`; on a phone over USB:
/// `adb reverse tcp:5073 tcp:5073` and `--dart-define=SERVER=http://localhost:5073`. Harder: `--dart-define=STRESS=3`;
/// a run again: `--dart-define=SEED=<the seed it printed>`. Hardware decoding and the picture only really get tested
/// on a device (an emulator gives mpv no video output).
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  MediaKit.ensureInitialized();
  stressTests();
}
