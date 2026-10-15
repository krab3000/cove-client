import 'package:cove_client/api/cove_client.dart';
import 'package:cove_client/features/filter/components/condition_editor.dart';
import 'package:cove_client/features/filter/filter_screen.dart';
import 'package:cove_client/ui/icons.dart';
import 'package:cove_client/ui/sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'harness.dart';

/// The filter editor (phone 2b, full screen; tablet 2d, a drawer over the Library; 3a–3c, 4a–4c): conditions on a
/// library folder and a duration, the group's operator, applying it; copy and paste, wrap and ungroup, remove, Save
/// as…, the saved filter, Clear all; on a tablet, the Library following the edits.
void filterTests() {
  group('filter', () {
    Finder inEditor(Finder f) =>
        find.descendant(of: find.byType(FilterScreen), matching: f);

    /// + Add's and the ⋮ menus: a bottom sheet on a phone, a sheet inside the drawer on a tablet.
    Finder inFilterMenu(Finder f) => tablet
        ? find.descendant(of: find.byType(InlineSheet), matching: f)
        : inSheet(f);

    /// The condition editor's pages (fields, a field, the folders): in a sheet on a phone, in the drawer on a tablet.
    Finder inCondition(Finder f) =>
        find.descendant(of: find.byType(ConditionEditor), matching: f);

    /// How many videos the filter matches: "Show N videos" (a phone's footer), "N videos match" (a tablet's).
    Finder matching(int count) =>
        inEditor(find.text(tablet ? '$count videos match' : 'Show $count videos'));

    Future<void> openEditor(WidgetTester tester) async {
      await tap(tester, find.bySemanticsLabel(RegExp('^Show: ')));
      await tap(tester, inMenu(find.text('Edit conditions…')));
      await waitFor(tester, find.byType(FilterScreen));
      // A tablet's drawer slides in
      await settle(tester, 500);
    }

    /// Applies it and closes: Show (a phone), Done (a tablet: the Library follows the edits anyway).
    Future<void> apply(WidgetTester tester, int count) async {
      await tap(tester, tablet ? inEditor(find.text('Done')) : matching(count));
      await waitGone(tester, find.byType(FilterScreen));
    }

    /// + Add → Condition → the field (the list scrolls to it).
    Future<void> addCondition(WidgetTester tester, String fieldName) async {
      await tap(tester, inEditor(find.text('Add')).last);
      await tap(tester, inFilterMenu(find.text('Condition')));
      await waitFor(tester, inCondition(find.text('Add a condition')));
      final item = inCondition(find.text(fieldName));
      await tester.scrollUntilVisible(
        item,
        200,
        scrollable: inCondition(find.byType(Scrollable)).first,
      );
      await tap(tester, item);
    }

    Future<void> durationOver(WidgetTester tester, int minutes) async {
      await addCondition(tester, 'Duration');
      expect(inCondition(find.text('greater than')), findsOneWidget);
      await type(tester, inCondition(find.byType(TextField)).first, '$minutes');
      await tap(tester, inCondition(find.text('Add condition')));
      await waitGone(tester, find.byType(ConditionEditor));
    }

    /// The ⋮ menus in tree order: the root group's first, then its rows.
    Future<void> menu(WidgetTester tester, int index, String entry) async {
      await tap(tester, inEditor(find.byIcon(Phosphor.dotsThreeVertical)).at(index));
      await tap(tester, inFilterMenu(find.text(entry)));
    }

    testWidgets('a library folder and a duration, All of / Any of, applied', (
      tester,
    ) async {
      final client = await launchSignedIn(tester);
      final videos = (await client.findVideos(1, 1000)).items;
      final total = videos.length;
      bool exotic(v) => v.primaryFile?.basename.startsWith('Exotic ') ?? false;
      bool long(v) => (v.primaryFile?.duration ?? 0) > 600;
      final exotics = videos.where(exotic).length;
      final either = videos.where((v) => exotic(v) || long(v)).length;
      expect(exotics, greaterThan(0), reason: 'test-server/make-exotic.sh');

      await openEditor(tester);
      expect(inEditor(find.text(tablet ? 'Filter' : 'New filter')), findsOneWidget);
      expect(
        inEditor(find.text('All videos. Add a condition to narrow them down.')),
        findsOneWidget,
      );
      await waitFor(tester, matching(total));

      // Path: in the folder, picked in the library's folders (3a, 3b)
      await addCondition(tester, 'Path');
      expect(inCondition(find.text('In folder')), findsOneWidget);
      await tap(tester, inCondition(find.text('Browse')));
      await waitFor(tester, inCondition(find.text('/media')));
      await tap(tester, inCondition(find.text('/media')));
      await tap(tester, inCondition(find.text('Exotic')));
      await waitFor(tester, inCondition(find.text('Use “Exotic” · $exotics videos')));
      await tap(tester, inCondition(find.textContaining('Use “Exotic”')));
      await waitFor(tester, inCondition(find.text('With this condition')));
      await tap(tester, inCondition(find.text('Add condition')));
      await waitGone(tester, find.byType(ConditionEditor));
      await waitFor(tester, matching(exotics));
      expect(inEditor(find.text('this 1')), findsOneWidget);

      // And a duration over 10 minutes: none of the short Exotic cuts
      await durationOver(tester, 10);
      expect(inEditor(find.text('these 2')), findsOneWidget);
      await waitFor(tester, matching(0));

      // The group's operator cycles: Any of
      await tap(tester, inEditor(find.text('All of')).first);
      await waitFor(tester, inEditor(find.text('Any of')));
      await waitFor(tester, matching(either));

      // Applied: the Library shows them, the pill says so
      await apply(tester, either);
      await waitFor(tester, countLine(either));
      expect(find.bySemanticsLabel(RegExp('^Show: Videos, 2 ')), findsOneWidget);
    });

    testWidgets('copy, paste, wrap, ungroup, remove; Save as…; Clear all', (
      tester,
    ) async {
      final client = await launchSignedIn(tester);
      final name = 'e2e ${DateTime.now().millisecondsSinceEpoch}';
      addTearDown(() => _deleteSaved(client, name));

      await openEditor(tester);
      await durationOver(tester, 10);
      expect(inEditor(find.text('this 1')), findsOneWidget);

      // Copy the condition, paste it beside + Add
      await menu(tester, 1, 'Copy');
      await waitFor(tester, inEditor(find.textContaining('Copied')));
      await tap(tester, inEditor(find.text('Paste')));
      await waitFor(tester, inEditor(find.text('these 2')));

      // Wrap the whole filter in a group, and ungroup it again
      await menu(tester, 0, 'Wrap in group');
      await waitFor(tester, inEditor(find.text('this 1')));
      await menu(tester, 1, 'Ungroup');
      await waitFor(tester, inEditor(find.text('these 2')));

      // Remove one
      await menu(tester, 1, 'Remove condition');
      await waitFor(tester, inEditor(find.text('this 1')));

      // Save as…: a saved filter in Cove, named in the editor (a sheet on a phone, a dialog on a tablet)
      await tap(tester, inEditor(find.text('Save as…')));
      await waitFor(tester, find.text('Save as a new filter'));
      await type(tester, field('Name'), name);
      await tap(tester, find.text('Save'));
      await waitFor(tester, inEditor(find.text(name)));
      expect((await client.savedFilters()).map((f) => f.name), contains(name));

      // Closed, it is among the saved filters (the Show sheet, the sidebar)
      await tap(
        tester,
        tablet ? inEditor(find.text('Done')) : inEditor(find.byIcon(Phosphor.caretLeft)),
      );
      await waitGone(tester, find.byType(FilterScreen));
      await showInLibrary(tester, name);
      await waitFor(tester, find.bySemanticsLabel(RegExp('^Show: ${RegExp.escape(name)}')));

      // Clear all: empty, the saved filter can't be saved
      await openEditor(tester);
      expect(inEditor(find.text(name)), findsOneWidget);
      expect(inEditor(find.text('Save')), findsNothing);
      await menu(tester, 0, 'Clear all');
      await waitFor(tester, inEditor(find.text('All videos. Add a condition to narrow them down.')));
      expect(inEditor(find.text('Save')), findsNothing);

      // Another condition: Save writes the saved filter
      await durationOver(tester, 20);
      await tap(tester, inEditor(find.text('Save')));
      await waitGone(tester, inEditor(find.text('Save')));
      final saved = (await client.savedFilters()).firstWhere((f) => f.name == name);
      expect('${saved.objectFilter}', contains('1200'));
    });

    testWidgets(
      'tablet: the Library follows the drawer\'s edits',
      skip: !tablet,
      tags: [tabletTag],
      (tester) async {
        final client = await launchSignedIn(tester);
        final videos = (await client.findVideos(1, 1000)).items;
        final long = videos.where((v) => (v.primaryFile?.duration ?? 0) > 600).length;

        await openEditor(tester);
        await durationOver(tester, 10);
        // Still editing: the Library beside already shows them
        await waitFor(tester, countLine(long));
        expect(find.byType(FilterScreen), findsOneWidget);
        expect(find.bySemanticsLabel(RegExp('^Show: Videos, 1 ')), findsOneWidget);

        // Its ✕ closes it; the filter stays
        await tap(tester, inEditor(label('Close')));
        await waitGone(tester, find.byType(FilterScreen));
        expect(countLine(long), findsOneWidget);
      },
    );
  });
}

Future<void> _deleteSaved(CoveClient client, String name) async {
  for (final f in await client.savedFilters()) {
    if (f.name == name) await client.request('DELETE', 'savedfilters/${f.id}');
  }
}
