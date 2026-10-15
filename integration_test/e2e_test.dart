import 'package:integration_test/integration_test.dart';
import 'package:media_kit/media_kit.dart';

import 'e2e/filter_e2e.dart';
import 'e2e/library_e2e.dart';
import 'e2e/player_e2e.dart';
import 'e2e/settings_e2e.dart';
import 'e2e/sign_in_e2e.dart';

/// End to end: the real app, every screen and feature, against the test server (test-server/), on a phone first.
/// `flutter test integration_test/e2e_test.dart -d emulator-5554` (the emulator reaches it at http://10.0.2.2:5073;
/// elsewhere `--dart-define=SERVER=...`); one area: `--plain-name "player "`. The areas are in `e2e/`.
/// It starts from a first launch: the servers and settings kept on the device are cleared.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  MediaKit.ensureInitialized();
  signInTests();
  libraryTests();
  filterTests();
  playerTests();
  settingsTests();
}
