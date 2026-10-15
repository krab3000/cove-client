import 'package:cove_client/features/settings/settings_screen.dart';
import 'package:cove_client/state/prefs.dart';
import 'package:cove_client/state/settings_nav.dart';
import 'package:cove_client/ui/icons.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'harness.dart';

/// The Library on a phone (8a–8c, 6c–6e, 1g): the count, the three views, Shuffle, search, the Show sheet (quick and
/// saved filters, all videos), the Feed's tags and marks, the account sheet.
void libraryTests() {
  group('library', () {
    testWidgets('the count, the three views and Shuffle', (tester) async {
      final client = await launchSignedIn(tester);
      final total = (await client.findVideos(1, 0)).totalCount;
      await waitFor(tester, countLine(total));
      expect(find.byType(GridView), findsOneWidget);
      expect(find.text('Newest'), findsOneWidget);

      // The view menu: Dense grid (default), Grid, Feed
      expect(label('View: Dense grid'), findsOneWidget);
      for (final (name, view) in [
        ('Grid', LibraryView.grid2),
        ('Feed', LibraryView.list),
        ('Dense grid', LibraryView.grid3),
      ]) {
        await tap(tester, find.bySemanticsLabel(RegExp('^View: ')));
        await tap(tester, find.text(name), settleMs: 900);
        expect(label('View: $name'), findsOneWidget);
        expect(prefs.libraryView, view);
      }

      // Shuffle: random order, and back
      await tap(tester, label('Shuffle'));
      await waitFor(tester, find.text('Random'));
      await waitFor(tester, countLine(total));
      await tap(tester, label('Shuffle'));
      await waitFor(tester, find.text('Newest'));
    });

    testWidgets('search, and clearing it', (tester) async {
      final client = await launchSignedIn(tester);
      final total = (await client.findVideos(1, 0)).totalCount;
      final sintel = (await client.findVideos(1, 0, q: 'Sintel')).totalCount;
      expect(sintel, inInclusiveRange(1, total - 1));

      await type(tester, find.byType(TextField), 'Sintel');
      await waitFor(tester, countLine(sintel));
      expect(find.bySemanticsLabel(RegExp('^Show: Videos')), findsOneWidget);

      await tap(tester, label('Clear search'));
      await waitFor(tester, countLine(total));
      expect(find.bySemanticsLabel(RegExp('^Show: All videos')), findsOneWidget);
    });

    testWidgets('the Show sheet: quick filters, a saved filter, all videos', (
      tester,
    ) async {
      final client = await launchSignedIn(tester);
      final total = (await client.findVideos(1, 0)).totalCount;
      await waitFor(tester, countLine(total));

      Future<void> show(String row) async {
        await tap(tester, find.bySemanticsLabel(RegExp('^Show: ')));
        expect(find.text('Show'), findsOneWidget);
        await tap(tester, inSheet(find.text(row)));
      }

      for (final quick in ['Unwatched', 'In progress']) {
        await show(quick);
        await waitFor(tester, find.bySemanticsLabel(RegExp('^Show: Videos, 1 ')));
        await waitUntil(
          tester,
          () => find.textContaining(RegExp(r'^\d+ videos')).evaluate().isNotEmpty,
          'the count of $quick',
        );
        expect(shownCount(), lessThanOrEqualTo(total));
      }

      // A saved filter brings its name to the pill
      final saved = await client.savedFilters();
      if (saved.isNotEmpty) {
        final first = ([...saved]..sort((a, b) => a.name.compareTo(b.name))).first;
        await show(first.name);
        await waitFor(tester, find.bySemanticsLabel(RegExp('^Show: ${RegExp.escape(first.name)}')));
        await waitUntil(
          tester,
          () => find.textContaining(RegExp(r'^\d+ videos')).evaluate().isNotEmpty,
          'the count of ${first.name}',
        );
      }

      await show('All videos');
      await waitFor(tester, countLine(total));
      expect(find.bySemanticsLabel(RegExp('^Show: All videos')), findsOneWidget);
    });

    testWidgets('Feed: marks a video and filters by its tag', (tester) async {
      final client = await launchSignedIn(tester);
      // The one video with tags in the test library
      const title = 'Big Buck Bunny 2160p60';
      final video = (await client.findVideos(1, 5, q: title)).items.firstWhere(
        (v) => v.primaryFile?.basename.startsWith(title) ?? false,
      );
      final favorite =
          (await client.engagement([video.id]))[video.id]?.isFavorite ?? false;
      final later = (await client.savedForLater([video.id])).contains(video.id);

      await tap(tester, find.bySemanticsLabel(RegExp('^View: ')));
      await tap(tester, find.text('Feed'), settleMs: 900);
      await type(tester, find.byType(TextField), title);
      final card = find.descendant(of: find.byType(GridView), matching: find.text(title));
      await waitFor(tester, card);
      // The user's data on the card (watched N× / unwatched): the marks show what Cove has
      await waitFor(
        tester,
        find.descendant(of: find.byType(GridView), matching: find.textContaining('watched')),
      );
      expect(
        find.descendant(
          of: find.byType(GridView),
          matching: find.byIcon(Phosphor.fill(Phosphor.heart)),
        ),
        favorite ? findsWidgets : findsNothing,
      );

      // Favorite and Save for later go to Cove, and back
      final inFeed = find.byType(GridView);
      final heart = find.descendant(of: inFeed, matching: label('Favorite')).first;
      final bookmark = find.descendant(of: inFeed, matching: label('Save for later')).first;
      await tap(tester, heart);
      await settle(tester, 1000);
      expect((await client.engagement([video.id]))[video.id]?.isFavorite, !favorite);
      await tap(tester, heart);
      await settle(tester, 1000);
      expect((await client.engagement([video.id]))[video.id]?.isFavorite, favorite);

      await tap(tester, bookmark);
      await settle(tester, 1000);
      expect((await client.savedForLater([video.id])).contains(video.id), !later);
      await tap(tester, bookmark);
      await settle(tester, 1000);
      expect((await client.savedForLater([video.id])).contains(video.id), later);

      // Its tag: a condition on the filter
      final tag = find.descendant(of: inFeed, matching: find.text('Comedy'));
      await tap(tester, tag);
      await waitFor(tester, find.bySemanticsLabel(RegExp('^Show: Videos, 1 ')));
      await waitFor(tester, countLine(1));
    });

    testWidgets('the account sheet: Refresh, Settings', (tester) async {
      final client = await launchSignedIn(tester);
      final total = (await client.findVideos(1, 0)).totalCount;
      await tap(tester, label('Account'));
      expect(find.text(username), findsOneWidget);
      expect(find.text(server.replaceFirst(RegExp('^https?://'), '')), findsOneWidget);
      await tap(tester, find.text('Refresh library'));
      await waitFor(tester, countLine(total));

      await tap(tester, label('Account'));
      await tap(tester, inSheet(find.text('Settings')));
      await waitFor(tester, find.byType(SettingsScreen));
      expect(settingsNav.from, SettingsFrom.library);
      await tap(
        tester,
        find.descendant(
          of: find.byType(SettingsScreen),
          matching: find.byIcon(Phosphor.caretLeft),
        ),
      );
      await waitGone(tester, find.byType(SettingsScreen));
    });
  });
}
