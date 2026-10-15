import 'package:cove_client/features/library/components/video_detail.dart';
import 'package:cove_client/features/player/player_screen.dart';
import 'package:cove_client/features/settings/settings_screen.dart';
import 'package:cove_client/state/prefs.dart';
import 'package:cove_client/state/settings_nav.dart';
import 'package:cove_client/ui/icons.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'harness.dart';

/// The Library (phone 8a–8c, 6c–6e, 1g; tablet 8f, 1h): the count, the three views, Shuffle, search, what it shows
/// (quick and saved filters, all videos: the phone's Show sheet, the tablet's sidebar), the Feed's tags and marks,
/// the account's menu; on a tablet, the preview drawer.
void libraryTests() {
  group('library', () {
    testWidgets('the count, the three views and Shuffle', (tester) async {
      final client = await launchSignedIn(tester);
      final total = (await client.findVideos(1, 0)).totalCount;
      await waitFor(tester, countLine(total));
      expect(find.byType(GridView), findsOneWidget);
      expect(find.text('Newest'), findsOneWidget);

      // The views: Dense grid (default), Grid, Feed
      expect(prefs.libraryView, LibraryView.grid3);
      if (!tablet) expect(label('View: Dense grid'), findsOneWidget);
      for (final (name, view) in [
        ('Grid', LibraryView.grid2),
        ('Feed', LibraryView.list),
        ('Dense grid', LibraryView.grid3),
      ]) {
        await setView(tester, name);
        if (!tablet) expect(label('View: $name'), findsOneWidget);
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

    testWidgets('what it shows: quick filters, a saved filter, all videos', (
      tester,
    ) async {
      final client = await launchSignedIn(tester);
      final total = (await client.findVideos(1, 0)).totalCount;
      await waitFor(tester, countLine(total));

      for (final quick in ['Unwatched', 'In progress']) {
        await showInLibrary(tester, quick);
        await waitFor(tester, find.bySemanticsLabel(RegExp('^Show: Videos, 1 ')));
        await waitUntil(tester, () => shownCount() != null, 'the count of $quick');
        expect(shownCount(), lessThanOrEqualTo(total));
      }

      // A saved filter brings its name to the pill
      final saved = await client.savedFilters();
      if (saved.isNotEmpty) {
        final first = ([...saved]..sort((a, b) => a.name.compareTo(b.name))).first;
        await showInLibrary(tester, first.name);
        await waitFor(tester, find.bySemanticsLabel(RegExp('^Show: ${RegExp.escape(first.name)}')));
        await waitUntil(tester, () => shownCount() != null, 'the count of ${first.name}');
      }

      await showInLibrary(tester, 'All videos');
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

      await setView(tester, 'Feed');
      await type(tester, find.byType(TextField), title);
      final inFeed = find.byType(GridView);
      await waitFor(tester, find.descendant(of: inFeed, matching: find.text(title)));
      // The user's data on the card (watched N× / unwatched): the marks show what Cove has
      await waitFor(tester, find.descendant(of: inFeed, matching: find.textContaining('watched')));
      expect(
        find.descendant(of: inFeed, matching: find.byIcon(Phosphor.fill(Phosphor.heart))),
        favorite ? findsWidgets : findsNothing,
      );

      // Favorite and Save for later go to Cove, and back
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
      await tap(tester, find.descendant(of: inFeed, matching: find.text('Comedy')));
      await waitFor(tester, find.bySemanticsLabel(RegExp('^Show: Videos, 1 ')));
      await waitFor(tester, countLine(1));
    });

    testWidgets("the account's menu: Refresh, Settings", (tester) async {
      final client = await launchSignedIn(tester);
      final total = (await client.findVideos(1, 0)).totalCount;
      await tap(tester, label('Account'));
      // Who and where: the phone's sheet says so; the tablet's sidebar always does
      expect(find.text(username), findsWidgets);
      expect(find.text(server.replaceFirst(RegExp('^https?://'), '')), findsWidgets);
      await tap(tester, inMenu(find.text('Refresh library')));
      await waitFor(tester, countLine(total));

      await account(tester, 'Settings');
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

    testWidgets(
      'tablet: a card opens its preview drawer; marks there; the same card again plays',
      skip: !tablet,
      tags: [tabletTag],
      (tester) async {
        final client = await launchSignedIn(tester);
        const title = 'Elephants Dream 480p';
        await type(tester, find.byType(TextField), 'Elephants Dream');
        final card = find.descendant(of: find.byType(GridView), matching: find.text(title));
        await tap(tester, card);

        // The drawer (1h): the video, its preview clip, Play, the marks
        final drawer = find.byType(VideoDetail);
        Finder inDrawer(Finder f) => find.descendant(of: drawer, matching: f);
        await waitFor(tester, drawer);
        expect(inDrawer(find.text('PREVIEW')), findsOneWidget);
        expect(inDrawer(find.text(title)), findsOneWidget);
        expect(inDrawer(label('Play $title')), findsOneWidget);

        final video = (await client.findVideos(1, 5, q: 'Elephants Dream')).items.firstWhere(
          (v) => v.primaryFile?.basename.startsWith(title) ?? false,
        );
        await settle(tester, 1500);
        final favorite =
            (await client.engagement([video.id]))[video.id]?.isFavorite ?? false;
        await tap(tester, inDrawer(label('Favorite')));
        await settle(tester, 1000);
        expect((await client.engagement([video.id]))[video.id]?.isFavorite, !favorite);
        await tap(tester, inDrawer(label('Favorite')));
        await settle(tester, 1000);
        expect((await client.engagement([video.id]))[video.id]?.isFavorite, favorite);

        // ✕ closes it; the card opens it again, and once more plays
        await tap(tester, inDrawer(find.byIcon(Phosphor.x)));
        await waitGone(tester, drawer);
        await tap(tester, card);
        await waitFor(tester, drawer);
        await tap(tester, card);
        await waitFor(tester, find.byType(PlayerScreen));
        await closePlayer(tester);
      },
    );
  });
}
