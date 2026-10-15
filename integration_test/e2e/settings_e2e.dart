import 'package:cove_client/features/player/components/playback_options.dart';
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

    /// Taps a row: on a tablet in its [section] (7d: one section beside the list of them), on a phone scrolled to in
    /// the one list (its rows are built as they show).
    Future<void> row(WidgetTester tester, Finder f, String section) async {
      if (tablet) await tap(tester, inSettings(label(section)).first);
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
      expect(inSettings(find.text(tablet ? 'On this device' : 'PLAYBACK')), findsOneWidget);

      // A switch
      expect(prefs.autoplay, isTrue);
      await row(tester, inSettings(find.text('Autoplay next')), 'Playback');
      expect(prefs.autoplay, isFalse);

      // A choice: in a sheet on a phone (7b), a dialog on a tablet
      await row(tester, inSettings(find.text('Skip step')), 'Playback');
      final option = tablet ? find.text('30 s') : inSheet(find.text('30 s'));
      await waitFor(tester, option);
      await tap(tester, option);
      expect(prefs.seekStep, 30);
      await waitGone(
        tester,
        find.text('How far the skip buttons, and a double tap on either side of the video, jump.'),
      );
      expect(inSettings(find.text('30 s')), findsOneWidget);

      // Segments
      await row(tester, inSettings(find.text('2 columns')), 'Library & previews');
      expect(prefs.libraryView, LibraryView.grid2);
      await row(tester, inSettings(find.text('Verbose')), 'Diagnostics');
      expect(prefs.playerLog, 'v');

      // Kept on the device
      await settle(tester, 800);
      final kept = await SharedPreferencesAsync().getString('cove/prefs/v1');
      expect(kept, contains('"seekStep":30'));
      expect(kept, contains('"autoplay":false'));

      // About, and Reset to defaults
      if (tablet) await tap(tester, inSettings(label('About')).first);
      await tester.scrollUntilVisible(
        inSettings(find.text('This device: Android')),
        300,
        scrollable: inSettings(find.byType(Scrollable)).first,
      );
      await row(tester, inSettings(find.text('Reset to defaults')), 'About');
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
      await playCard(tester, 'Elephants Dream 480p');
      await waitFor(tester, label('Forward 30 seconds'), timeout: const Duration(seconds: 40));

      // Playback sheet → All settings: Settings over the player, which pauses
      await tap(tester, label('Playback'));
      await tap(
        tester,
        find.descendant(of: find.byType(PlaybackOptions), matching: find.text('All settings')),
      );
      await waitFor(tester, find.byType(SettingsScreen));
      expect(settingsNav.from, SettingsFrom.player);
      await back(tester);
      expect(find.byType(PlayerScreen), findsOneWidget);
      expect(label('Play'), findsOneWidget);
      await closePlayer(tester);
    });
  });
}
