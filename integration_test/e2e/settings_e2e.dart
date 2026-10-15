import 'package:cove_client/features/player/player_screen.dart';
import 'package:cove_client/features/settings/settings_screen.dart';
import 'package:cove_client/features/signin/sign_in_screen.dart';
import 'package:cove_client/state/prefs.dart';
import 'package:cove_client/state/settings_nav.dart';
import 'package:cove_client/ui/icons.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'harness.dart';

/// Settings on a phone (7a, 7b): from sign-in and from the player; a switch, a choice in a sheet and segments; kept
/// on the device; Reset to defaults.
void settingsTests() {
  group('settings', () {
    Finder inSettings(Finder f) =>
        find.descendant(of: find.byType(SettingsScreen), matching: f);

    /// Scrolls Settings' list to [f] (its rows are built as they show) and taps it.
    Future<void> row(WidgetTester tester, Finder f) async {
      await tester.scrollUntilVisible(
        f,
        200,
        scrollable: inSettings(find.byType(Scrollable)).first,
      );
      await tap(tester, f);
    }

    /// Back, at the top of the list (scrolled to it).
    Future<void> back(WidgetTester tester) async {
      tester
          .state<ScrollableState>(inSettings(find.byType(Scrollable)).first)
          .position
          .jumpTo(0);
      await settle(tester, 300);
      await tap(tester, inSettings(find.byIcon(Phosphor.caretLeft)));
      await waitGone(tester, find.byType(SettingsScreen));
    }

    testWidgets('from sign-in: every kind of setting, kept, and reset', (
      tester,
    ) async {
      await launch(tester);
      await tap(tester, find.byIcon(Phosphor.gearSix));
      await waitFor(tester, find.byType(SettingsScreen));
      expect(settingsNav.from, SettingsFrom.signIn);
      expect(inSettings(find.text('PLAYBACK')), findsOneWidget);

      // A switch
      expect(prefs.autoplay, isTrue);
      await row(tester, inSettings(find.text('Autoplay next')));
      expect(prefs.autoplay, isFalse);

      // A choice, in a sheet
      await row(tester, inSettings(find.text('Skip step')));
      await waitFor(tester, inSheet(find.text('30 s')));
      await tap(tester, inSheet(find.text('30 s')));
      await waitGone(tester, find.byType(BottomSheet));
      expect(prefs.seekStep, 30);
      expect(inSettings(find.text('30 s')), findsOneWidget);

      // Segments
      await row(tester, inSettings(find.text('2 columns')));
      expect(prefs.libraryView, LibraryView.grid2);
      await row(tester, inSettings(find.text('Verbose')));
      expect(prefs.playerLog, 'v');

      // Kept on the device
      await settle(tester, 800);
      final kept = await SharedPreferencesAsync().getString('cove/prefs/v1');
      expect(kept, contains('"seekStep":30'));
      expect(kept, contains('"autoplay":false'));

      // About, and Reset to defaults
      await tester.scrollUntilVisible(
        inSettings(find.text('This device: Android')),
        300,
        scrollable: inSettings(find.byType(Scrollable)).first,
      );
      await row(tester, inSettings(find.text('Reset to defaults')));
      expect(prefs.autoplay, isTrue);
      expect(prefs.seekStep, 10);
      expect(prefs.libraryView, LibraryView.grid3);
      expect(prefs.playerLog, 'warn');

      await back(tester);
      expect(find.byType(SignInScreen), findsOneWidget);
    });

    testWidgets('the skip step in the player; Settings from the player', (
      tester,
    ) async {
      await launchSignedIn(tester);
      prefs.set('hideAfterMs', 0);
      prefs.set('seekStep', 30);
      await type(tester, find.byType(TextField), 'Elephants Dream');
      await tap(
        tester,
        find.descendant(of: find.byType(GridView), matching: find.text('Elephants Dream 480p')),
      );
      await waitFor(tester, find.byType(PlayerScreen));
      await waitFor(tester, label('Forward 30 seconds'), timeout: const Duration(seconds: 40));

      // Playback sheet → All settings: Settings over the player, which pauses
      await tap(tester, label('Playback'));
      await tap(tester, inSheet(find.text('All settings')));
      await waitFor(tester, find.byType(SettingsScreen));
      expect(settingsNav.from, SettingsFrom.player);
      await back(tester);
      expect(find.byType(PlayerScreen), findsOneWidget);
      expect(label('Play'), findsOneWidget);
      await tap(tester, label('Close the player'));
      await waitGone(tester, find.byType(PlayerScreen));
    });
  });
}
