import 'package:cove_client/api/cove_client.dart';
import 'package:cove_client/features/filter/filter_screen.dart';
import 'package:cove_client/ui/icons.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'harness.dart';

/// The filter editor on a phone (2b, 3a–3c, 4a–4c): conditions on a library folder and a duration, the group's
/// operator, Show; copy and paste, wrap and ungroup, remove, Save as…, the saved filter, Clear all.
void filterTests() {
  group('filter', () {
    Finder inEditor(Finder f) =>
        find.descendant(of: find.byType(FilterScreen), matching: f);

    Future<void> openEditor(WidgetTester tester) async {
      await tap(tester, find.bySemanticsLabel(RegExp('^Show: ')));
      await tap(tester, inSheet(find.text('Edit conditions…')));
      await waitFor(tester, find.byType(FilterScreen));
    }

    /// + Add → Condition → the field (the sheet's list scrolls to it).
    Future<void> addCondition(WidgetTester tester, String fieldName) async {
      await tap(tester, inEditor(find.text('Add')).last);
      await tap(tester, inSheet(find.text('Condition')));
      await waitFor(tester, find.text('Add a condition'));
      final item = inSheet(find.text(fieldName));
      await tester.scrollUntilVisible(
        item,
        200,
        scrollable: inSheet(find.byType(Scrollable)).first,
      );
      await tap(tester, item);
    }

    Future<void> durationOver(WidgetTester tester, int minutes) async {
      await addCondition(tester, 'Duration');
      expect(inSheet(find.text('greater than')), findsOneWidget);
      await type(tester, inSheet(find.byType(TextField)).first, '$minutes');
      await tap(tester, inSheet(find.text('Add condition')));
      await waitGone(tester, find.text('Add condition'));
    }

    /// The ⋮ menus in tree order: the root group's first, then its rows.
    Future<void> menu(WidgetTester tester, int index, String entry) async {
      await tap(tester, inEditor(find.byIcon(Phosphor.dotsThreeVertical)).at(index));
      await tap(tester, inSheet(find.text(entry)));
    }

    Finder show(int count) => inEditor(find.text('Show $count videos'));

    testWidgets('a library folder and a duration, All of / Any of, Show', (
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
      expect(inEditor(find.text('New filter')), findsOneWidget);
      expect(
        inEditor(find.text('All videos. Add a condition to narrow them down.')),
        findsOneWidget,
      );
      await waitFor(tester, show(total));

      // Path: in the folder, picked in the library's folders (3a, 3b)
      await addCondition(tester, 'Path');
      expect(inSheet(find.text('In folder')), findsOneWidget);
      await tap(tester, inSheet(find.text('Browse')));
      await waitFor(tester, inSheet(find.text('/media')));
      await tap(tester, inSheet(find.text('/media')));
      await tap(tester, inSheet(find.text('Exotic')));
      await waitFor(tester, inSheet(find.text('Use “Exotic” · $exotics videos')));
      await tap(tester, inSheet(find.textContaining('Use “Exotic”')));
      await waitFor(tester, inSheet(find.text('With this condition')));
      await tap(tester, inSheet(find.text('Add condition')));
      await waitGone(tester, find.text('Add condition'));
      await waitFor(tester, show(exotics));
      expect(inEditor(find.text('this 1')), findsOneWidget);

      // And a duration over 10 minutes: none of the short Exotic cuts
      await durationOver(tester, 10);
      expect(inEditor(find.text('these 2')), findsOneWidget);
      await waitFor(tester, show(0));

      // The group's operator cycles: Any of
      await tap(tester, inEditor(find.text('All of')).first);
      await waitFor(tester, inEditor(find.text('Any of')));
      await waitFor(tester, show(either));

      // Show: the Library shows them, the pill says so
      await tap(tester, show(either));
      await waitGone(tester, find.byType(FilterScreen));
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

      // Save as…: a saved filter in Cove, named in the header
      await tap(tester, inEditor(find.text('Save as…')));
      await waitFor(tester, find.text('Save as a new filter'));
      await type(tester, inSheet(field('Name')), name);
      await tap(tester, inSheet(find.text('Save')));
      await waitFor(tester, inEditor(find.text(name)));
      expect((await client.savedFilters()).map((f) => f.name), contains(name));

      // Closed, it is in the Show sheet
      await tap(tester, inEditor(find.byIcon(Phosphor.caretLeft)));
      await waitGone(tester, find.byType(FilterScreen));
      await tap(tester, find.bySemanticsLabel(RegExp('^Show: ')));
      await tap(tester, inSheet(find.text(name)));
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
  });
}

Future<void> _deleteSaved(CoveClient client, String name) async {
  for (final f in await client.savedFilters()) {
    if (f.name == name) await client.request('DELETE', 'savedfilters/${f.id}');
  }
}
