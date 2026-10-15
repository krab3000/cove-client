import 'dart:convert';

import 'package:cove_client/api/models.dart';
import 'package:cove_client/features/filter/model.dart';
import 'package:cove_client/features/filter/saved.dart';
import 'package:flutter_test/flutter_test.dart';

Condition cond(
  String field,
  Modifier m,
  Object value, {
  Object? value2,
  Map<int, String> names = const {},
}) => Condition(
  id: newId(),
  field: field,
  modifier: m,
  value: value,
  value2: value2,
  names: names,
);

Group grp(GroupOp op, List<Node> children) =>
    Group(id: newId(), op: op, children: children);

Json leaf(Json? wire) => (wire!['children'] as List).single['filter'] as Json;

void main() {
  group('wire', () {
    test('values per field type', () {
      expect(
        leaf(
          toWire(
            grp(GroupOp.all, [cond('duration', Modifier.greaterThan, 20)]),
          ),
        ),
        {
          'durationCriterion': {'value': 1200, 'modifier': 'greaterThan'},
        },
      );
      expect(
        leaf(
          toWire(
            grp(GroupOp.all, [cond('rating', Modifier.between, 3, value2: 5)]),
          ),
        ),
        {
          'ratingCriterion': {
            'value': 60,
            'value2': 100,
            'modifier': 'between',
          },
        },
      );
      // A bool criterion has no modifier
      expect(
        leaf(
          toWire(grp(GroupOp.all, [cond('favorite', Modifier.equals, true)])),
        ),
        {
          'favoriteCriterion': {'value': true},
        },
      );
      expect(
        leaf(
          toWire(
            grp(GroupOp.all, [
              cond('tags', Modifier.isNull, [3]),
            ]),
          ),
        ),
        {
          'tagsCriterion': {'value': <int>[], 'modifier': 'isNull'},
        },
      );
      expect(
        leaf(
          toWire(
            grp(GroupOp.all, [
              cond('createdAt', Modifier.between, ' -1y', value2: '0d'),
            ]),
          ),
        ),
        {
          'createdAtCriterion': {
            'value': '-1y',
            'value2': '0d',
            'modifier': 'between',
          },
        },
      );
    });

    test('groups: NOT wraps one child or an OR; empty groups go', () {
      final a = cond('title', Modifier.includes, 'a'),
          b = cond('title', Modifier.includes, 'b');
      final none = toWire(grp(GroupOp.none, [a, b]))!;
      expect(none['operator'], 'NOT');
      expect(
        ((none['children'] as List).single as Json)['group']['operator'],
        'OR',
      );
      expect(toWire(grp(GroupOp.all, [grp(GroupOp.any, [])])), isNull);
      expect(toWire(grp(GroupOp.one, [a, b]))!['operator'], 'JUST_ONE');
    });
  });

  group('saved filters', () {
    SavedFilter saved(Json object, {String? ui, String? find}) => SavedFilter(
      id: 1,
      name: 'x',
      objectFilter: jsonEncode(object),
      uiOptions: ui,
      findFilter: find,
    );

    test('a stored tree reads back and runs the same', () {
      final loaded = loadSavedFilter(
        saved(
          {
            '_filterExpression': {
              'operator': 'AND',
              'children': [
                {
                  'filter': {
                    'durationCriterion': {
                      'value': 300,
                      'modifier': 'GREATER_THAN',
                    },
                  },
                },
                {
                  'group': {
                    'operator': 'NOT',
                    'children': [
                      {
                        'group': {
                          'operator': 'OR',
                          'children': [
                            {
                              'filter': {
                                'tagsCriterion': {
                                  'value': [
                                    {'id': 4, 'label': 'Blurry'},
                                  ],
                                  'modifier': 'INCLUDES',
                                },
                              },
                            },
                            {
                              'filter': {
                                'ratingCriterion': {
                                  'value': 20,
                                  'modifier': 'LESS_THAN',
                                },
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
          ui: '{"displayMode":"list"}',
          find: '{"q":"drone"}',
        ),
      );
      expect(loaded.dropped, 0);
      expect(loaded.list, isTrue);
      expect(loaded.q, 'drone');
      final tree = loaded.tree;
      expect(tree.children.length, 2);
      final duration = tree.children[0] as Condition;
      expect(duration.value, 5); // minutes
      final none = tree.children[1] as Group;
      expect(none.op, GroupOp.none);
      expect((none.children[0] as Condition).names[4], 'Blurry');
      expect(describeCondition(duration), 'over 5 min');
      expect(runsText(outline(tree).first), 'All of: over 5 min');
      expect(
        runsText(groupPhrase(none)),
        'neither tagged Blurry nor rating is less than 1★',
      );
      // Written back in the web UI's format
      final change = savedFilterChange(
        const SavedFilter(id: 1, name: 'x'),
        tree,
        list: false,
        q: 'drone',
      );
      final stored = jsonDecode(
        change['objectFilter'] as String,
      )['_filterExpression'];
      expect(
        stored['children'][0]['filter']['durationCriterion']['modifier'],
        'GREATER_THAN',
      );
      expect(jsonDecode(change['uiOptions'] as String)['displayMode'], 'grid');
    });

    test('unknown criteria keep the filter whole on the wire', () {
      final loaded = loadSavedFilter(
        saved({
          'phashCriterion': {'value': 'abc', 'modifier': 'EQUALS'},
          'titleCriterion': {'value': 'x', 'modifier': 'INCLUDES'},
        }),
      );
      expect(loaded.dropped, 1);
      expect(loaded.tree.children.length, 1);
      final parts = loaded.wire!['children'] as List;
      expect(parts.length, 2);
      expect(parts[0]['filter']['phashCriterion']['modifier'], 'equals');
    });
  });

  group('editing the tree', () {
    test(
      'cut and paste moves; copy pastes copies; wrap, ungroup, simplify',
      () {
        final a = cond('title', Modifier.includes, 'a');
        final b = cond('title', Modifier.includes, 'b');
        final sub = grp(GroupOp.any, [b]);
        var tree = grp(GroupOp.all, [a, sub]);

        tree = paste(tree, Clipboard(a, cut: true), PasteInto(sub.id));
        expect(tree.children.length, 1);
        expect((tree.children.single as Group).children.map((c) => c.id), [
          b.id,
          a.id,
        ]);
        expect(canPaste(Clipboard(sub, cut: true), b.id), isFalse);

        tree = paste(
          tree,
          Clipboard(b, cut: false),
          PasteAt(sub.id, before: true),
        );
        expect(tree.children.length, 2);
        expect(tree.children.first.id, isNot(b.id)); // a new copy

        tree = wrapNode(tree, sub.id);
        expect(simplifiable(tree), 1);
        tree = ungroup(tree, (tree.children[1] as Group).id);
        expect(tree.children[1].id, sub.id);
        expect(
          simplify(
            grp(GroupOp.all, [
              grp(GroupOp.all, [a]),
            ]),
          ).children.single.id,
          a.id,
        );
      },
    );

    test('summary lines fold into "+ N more"', () {
      final tree = grp(GroupOp.all, [
        for (var i = 0; i < 8; i++)
          cond('title', Modifier.includes, 'something long $i'),
      ]);
      final lines = outline(tree);
      // A full first line: "+ N more" goes on a line of its own
      expect(lines.length, 2);
      expect(runsText(lines.last), '+ 7 more');
      expect(outline(tree, full: true).single.length, 9);
    });
  });

  test('relative dates', () {
    expect(parseRelative('-1y3m', false), isNotNull);
    expect(parseRelative('-3m1y', false), isNull); // units go down
    expect(parseRelative('-2h', false), isNull); // hours only for timestamps
    expect(parseRelative('5d', false), isNull); // unsigned only 0d
    expect(
      describeCondition(
        cond('createdAt', Modifier.between, '-1y', value2: '0d'),
      ),
      'added in the last year',
    );
    expect(
      validate(cond('date', Modifier.equals, 'soon')),
      contains('relative date'),
    );
    expect(
      validate(cond('tags', Modifier.includes, <int>[])),
      'Pick at least one tag.',
    );
  });
}
