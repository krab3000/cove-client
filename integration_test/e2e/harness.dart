import 'package:cove_client/api/cove_client.dart';
import 'package:cove_client/main.dart';
import 'package:cove_client/state/accounts.dart';
import 'package:cove_client/state/player.dart';
import 'package:cove_client/state/prefs.dart';
import 'package:cove_client/state/session.dart';
import 'package:cove_client/state/settings_nav.dart';
import 'package:cove_client/state/sign_in.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The test server (test-server/), as the device reaches it: the Android emulator's host is 10.0.2.2; a phone over
/// USB, after `adb reverse tcp:5073 tcp:5073`, and a desktop: --dart-define=SERVER=http://127.0.0.1:5073
const server = String.fromEnvironment(
  'SERVER',
  defaultValue: 'http://10.0.2.2:5073',
);
const username = 'admin';
const password = 'adminadmin';

/// The app as on a first launch: no servers, no kept sessions, default settings, nothing playing.
Future<void> resetApp() async {
  player.close();
  if (session.status == SessionStatus.signedIn) session.logout();
  settingsNav.close();
  accounts.change((_) => SignIn.empty);
  prefs.reset();
  await SharedPreferencesAsync().clear(
    allowList: {'cove/accounts/v1', 'cove/prefs/v1'},
  );
}

/// Launches the app (what main() does) from a first launch, or from what is kept when [clean] is false.
Future<void> launch(WidgetTester tester, {bool clean = true}) async {
  if (clean) await resetApp();
  await session.start();
  await tester.pumpWidget(const CoveApp());
  await settle(tester);
}

/// Signs in through the API. Cove allows 10 sign-ins (and token renewals) per 15 s from an address: a refusal
/// (429) waits and tries again.
Future<CoveClient> login() async {
  final end = DateTime.now().add(const Duration(seconds: 60));
  while (true) {
    try {
      return await CoveClient.login(server, username, password);
    } on CoveError catch (e) {
      if (e.status != 429 || DateTime.now().isAfter(end)) rethrow;
      await Future<void>.delayed(const Duration(seconds: 3));
    }
  }
}

// The tests' own client, for checking what the server says: one for the run (fewer sign-ins)
CoveClient? _checker;

/// Signed in to the test server (the server kept as "Test server"), on the Library; returns a client of the
/// tests' own for checking what the server says.
Future<CoveClient> launchSignedIn(WidgetTester tester) async {
  await resetApp();
  accounts.change(
    (_) => const SignIn(
      servers: [
        KeptServer(
          id: 'e2e',
          name: 'Test server',
          address: server,
          accounts: [],
          lastReached: null,
        ),
      ],
      last: null,
    ),
  );
  await session.start();
  session.enter(await login(), 'e2e');
  await tester.pumpWidget(const CoveApp());
  final client = _checker ??= await login();
  await waitFor(tester, find.textContaining(' videos'));
  return client;
}

/// Real time passing, frame by frame: the app's timers, animations and network calls go on.
Future<void> settle(WidgetTester tester, [int ms = 600]) async {
  final end = DateTime.now().add(Duration(milliseconds: ms));
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

/// Pumps until [condition] holds; pumpAndSettle never returns while a spinner turns or a video plays.
Future<void> waitUntil(
  WidgetTester tester,
  bool Function() condition,
  String what, {
  Duration timeout = const Duration(seconds: 20),
}) async {
  final end = DateTime.now().add(timeout);
  while (!condition()) {
    if (DateTime.now().isAfter(end)) fail('timed out waiting for $what');
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Future<void> waitFor(
  WidgetTester tester,
  Finder finder, {
  Duration timeout = const Duration(seconds: 20),
}) => waitUntil(
  tester,
  () => finder.evaluate().isNotEmpty,
  finder.toString(),
  timeout: timeout,
);

Future<void> waitGone(
  WidgetTester tester,
  Finder finder, {
  Duration timeout = const Duration(seconds: 20),
}) => waitUntil(
  tester,
  () => finder.evaluate().isEmpty,
  'no more $finder',
  timeout: timeout,
);

/// Taps (the first match, waiting for it to show) and lets the result animate in.
Future<void> tap(WidgetTester tester, Finder finder, {int settleMs = 500}) async {
  await waitFor(tester, finder);
  await tester.tap(finder.first);
  await settle(tester, settleMs);
}

/// A button by its label (Pressable's semantics; testWidgets turns semantics on). A label is merged with the
/// button's own text ("Account" and "A"), so it matches the label's first line.
Finder label(String text) =>
    find.bySemanticsLabel(RegExp('^${RegExp.escape(text)}(\n|\$)'));

/// A text field by its placeholder.
Finder field(String hint) => find.widgetWithText(TextField, hint);

/// Inside the bottom sheet that is open (the screen under it may say the same).
Finder inSheet(Finder finder) =>
    find.descendant(of: find.byType(BottomSheet).last, matching: finder);

Future<void> type(WidgetTester tester, Finder finder, String text) async {
  await waitFor(tester, finder);
  await tester.enterText(finder.first, text);
  await settle(tester, 300);
}

/// The Library's count line: "154 videos · 7 h · 6 GB".
Finder countLine(int count) => find.textContaining(RegExp('^$count videos'));

/// The count the Library shows now.
int? shownCount() {
  for (final e in find.textContaining(RegExp(r'^\d+ videos')).evaluate()) {
    final text = (e.widget as Text).data ?? '';
    return int.parse(text.split(' ').first);
  }
  return null;
}
