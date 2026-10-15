// Saved filters as Cove's web UI stores them: objectFilter is the page's filter state as JSON, flat criteria plus the
// rule tree under "_filterExpression", with modifiers and operators in the UI's SCREAMING_CASE ("INCLUDES_ALL",
// "JUST_ONE"); uiOptions has the display mode. This reads them into the rule tree of model.dart and writes the tree
// back the same way, so the web UI keeps reading what the app saves.

import 'dart:convert';

import '../../api/models.dart';
import 'model.dart';

const _treeKey = '_filterExpression';
// Page state in objectFilter that is not a criterion (Cove's compilation toggle).
const _stateKeys = ['includeCompilationGroups'];

const _ops = {
  'and': GroupOp.all,
  'or': GroupOp.any,
  'just_one': GroupOp.one,
  'justone': GroupOp.one,
  'not': GroupOp.none,
};

/// "INCLUDES_ALL" or "includesAll" -> "includesAll" (what videos/find takes).
String camelModifier(Object? m) {
  final s = '${m ?? ''}';
  if (!s.contains('_') && s != s.toUpperCase()) return s;
  return s.toLowerCase().replaceAllMapped(
    RegExp('_([a-z])'),
    (match) => match[1]!.toUpperCase(),
  );
}

/// "includesAll" -> "INCLUDES_ALL" (what the web UI stores).
String screamingModifier(String m) => m
    .replaceAllMapped(RegExp('([A-Z])'), (match) => '_${match[1]}')
    .toUpperCase();

Modifier? _modifier(Object? raw) {
  final name = camelModifier(raw ?? 'equals');
  for (final m in Modifier.values) {
    if (m.name == name) return m;
  }
  return null;
}

num _scaled(Object? v, num scale) {
  final n = (v is num ? v : num.tryParse('$v') ?? 0) / scale;
  final r = (n * 100).round() / 100;
  return r == r.roundToDouble() ? r.round() : r;
}

/// One criterion ({ value, value2?, modifier }) as a condition, or null for one the app doesn't know.
Condition? _toCondition(String key, Object? raw) {
  final field = fieldByKey(key);
  if (field == null || raw is! Map) return null;
  final modifier = _modifier(raw['modifier']);
  if (modifier == null) return null;
  final v2 = raw['value2'];
  Condition base(
    Object value, [
    Object? value2,
    Map<int, String> names = const {},
  ]) => Condition(
    id: newId(),
    field: field.id,
    modifier: field.type == FieldType.bool ? Modifier.equals : modifier,
    value: value,
    value2: value2,
    names: names,
  );
  switch (field.type) {
    case FieldType.multiId:
      // Ids, or { id, label } objects
      final ids = <int>[];
      final names = <int, String>{};
      for (final item in (raw['value'] as List?) ?? const []) {
        if (item is Map) {
          final id = (item['id'] as num).toInt();
          ids.add(id);
          final name = item['label'] ?? item['name'];
          if (name != null) names[id] = '$name';
        } else if (item is num) {
          ids.add(item.toInt());
        }
      }
      // Excluded ids and sub-tag depth aren't in the app's model
      if (raw['excludes'] is List && (raw['excludes'] as List).isNotEmpty)
        return null;
      return base(ids, null, names);
    case FieldType.bool:
      return base(raw['value'] == true);
    case FieldType.duration:
      return base(
        _scaled(raw['value'], 60),
        v2 == null ? null : _scaled(v2, 60),
      );
    case FieldType.rating:
      return base(
        _scaled(raw['value'], 20),
        v2 == null ? null : _scaled(v2, 20),
      );
    case FieldType.number || FieldType.resolution:
      return base(
        _scaled(raw['value'] ?? 0, 1),
        v2 == null ? null : _scaled(v2, 1),
      );
    default:
      return base('${raw['value'] ?? ''}', v2 == null ? null : '$v2');
  }
}

typedef _Parsed = ({List<Node> nodes, int dropped});

/// A filter leaf ({ key: criterion, ... }): one condition per criterion.
_Parsed _fromFilter(Map filter) {
  final nodes = <Node>[];
  var dropped = 0;
  for (final MapEntry(:key, :value) in filter.entries) {
    final c = _toCondition('$key', value);
    if (c != null) {
      nodes.add(c);
    } else {
      dropped++;
    }
  }
  return (nodes: nodes, dropped: dropped);
}

_Parsed _fromExpression(Map expr) {
  final op = _ops['${expr['operator'] ?? 'AND'}'.toLowerCase()];
  // Related-record blocks ("the same performer") aren't in the app's model
  if (op == null ||
      expr['relatedScope'] != null ||
      expr['distinctRelatedMatches'] == true) {
    return (nodes: const [], dropped: 1);
  }
  final children = <Node>[];
  var dropped = 0;
  for (final child in (expr['children'] as List?) ?? const []) {
    if (child is! Map) continue;
    _Parsed parsed;
    if (child['group'] is Map) {
      parsed = _fromExpression(child['group'] as Map);
    } else {
      parsed = _fromFilter((child['filter'] as Map?) ?? const {});
      // Several criteria in one leaf all apply: in an Any of / Just one of group they stay together.
      if (parsed.nodes.length > 1 && op != GroupOp.all) {
        parsed = (
          nodes: [Group(id: newId(), op: GroupOp.all, children: parsed.nodes)],
          dropped: parsed.dropped,
        );
      }
    }
    children.addAll(parsed.nodes);
    dropped += parsed.dropped;
  }
  // NOT takes one child: "NOT (a OR b)" is None of a, b.
  if (op == GroupOp.none && children.length == 1) {
    final only = children.first;
    if (only is Group && only.op == GroupOp.any) {
      return (nodes: [only.copyWith(op: GroupOp.none)], dropped: dropped);
    }
  }
  return (
    nodes: [Group(id: newId(), op: op, children: children)],
    dropped: dropped,
  );
}

Json _parse(String? s) {
  if (s == null || s.isEmpty) return {};
  try {
    final v = jsonDecode(s);
    return v is Map ? v.cast<String, dynamic>() : {};
  } catch (_) {
    return {};
  }
}

/// A saved filter as the rule tree, what to query with, and its view.
class LoadedFilter {
  const LoadedFilter({
    required this.tree,
    required this.dropped,
    required this.wire,
    required this.list,
    required this.q,
  });

  final Group tree;

  /// Criteria or blocks the app can't show; the filter still runs whole (see wire).
  final int dropped;

  /// What videos/find gets: the whole saved filter, modifiers as the API takes them.
  final Json? wire;

  /// The saved display mode: the list (true), a grid (false), none (null).
  final bool? list;

  /// The saved search text (findFilter.q), '' for none.
  final String q;
}

/// A criterion with its modifier in camelCase (the API rejects "NOT_EQUALS").
Object? _fix(Object? crit) => crit is Map && crit.containsKey('modifier')
    ? {...crit, 'modifier': camelModifier(crit['modifier'])}
    : crit;

/// A stored tree with every modifier camelCase; anything else on a group (relatedScope) stays.
Json _normalizeWire(Map expr) => {
  ...expr.cast<String, dynamic>(),
  'operator': '${expr['operator'] ?? 'AND'}'.toUpperCase(),
  'children': [
    for (final child in (expr['children'] as List?) ?? const [])
      if (child is Map && child['group'] is Map)
        {'group': _normalizeWire(child['group'] as Map)}
      else if (child is Map && child['filter'] is Map)
        {
          'filter': {
            for (final MapEntry(:key, :value)
                in (child['filter'] as Map).entries)
              '$key': _fix(value),
          },
        },
  ],
};

LoadedFilter loadSavedFilter(SavedFilter saved) {
  final object = _parse(saved.objectFilter);
  final flat = {
    for (final MapEntry(:key, :value) in object.entries)
      if (key != _treeKey && !_stateKeys.contains(key)) key: value,
  };
  final expr = object[_treeKey];
  final top = _fromFilter(flat);
  final children = [...top.nodes];
  var dropped = top.dropped;
  if (expr is Map) {
    final parsed = _fromExpression(expr);
    dropped += parsed.dropped;
    // An All of tree merges into the root (flat criteria and tree are ANDed)
    for (final node in parsed.nodes) {
      if (node is Group && node.op == GroupOp.all) {
        children.addAll(node.children);
      } else {
        children.add(node);
      }
    }
  }
  final tree = Group(id: newId(), op: GroupOp.all, children: children);

  // The query: the parsed tree when it is whole, else the saved filter itself
  var wire = toWire(tree);
  if (dropped > 0) {
    final parts = <Json>[
      for (final MapEntry(:key, :value) in flat.entries)
        {
          'filter': {key: _fix(value)},
        },
      if (expr is Map) {'group': _normalizeWire(expr)},
    ];
    wire = parts.isEmpty ? null : {'operator': 'AND', 'children': parts};
  }

  final mode = '${_parse(saved.uiOptions)['displayMode'] ?? ''}';
  return LoadedFilter(
    tree: tree,
    dropped: dropped,
    wire: wire,
    list: mode.isEmpty ? null : mode == 'list' || mode == 'feed',
    q: '${_parse(saved.findFilter)['q'] ?? ''}',
  );
}

/// The tree in the web UI's format (SCREAMING modifiers), for objectFilter._filterExpression.
Json _toStored(Json expr) => {
  'operator': expr['operator'],
  'children': [
    for (final child in expr['children'] as List)
      if ((child as Map)['group'] != null)
        {'group': _toStored(child['group'] as Json)}
      else
        {
          'filter': {
            for (final MapEntry(:key, :value)
                in (child['filter'] as Map).entries)
              '$key': value is Map && value['modifier'] is String
                  ? {
                      ...value,
                      'modifier': screamingModifier(
                        value['modifier'] as String,
                      ),
                    }
                  : value,
          },
        },
  ],
};

/// The display mode to store for a view, keeping a stored one of the same kind ("feed" for a list, "wall" for a grid).
String _displayModeFor(bool list, String stored) {
  if (list) return stored == 'feed' || stored == 'list' ? stored : 'list';
  return stored.isNotEmpty && stored != 'list' && stored != 'feed'
      ? stored
      : 'grid';
}

/// The change to save: the tree as the whole objectFilter (flat criteria were read into it; page state is kept), the
/// search in findFilter and the view in uiOptions (their other settings kept).
Json savedFilterChange(
  SavedFilter saved,
  Group tree, {
  required bool list,
  required String q,
}) {
  final object = _parse(saved.objectFilter);
  final wire = toWire(tree);
  final ui = _parse(saved.uiOptions);
  return {
    'findFilter': jsonEncode({..._parse(saved.findFilter), 'q': q.trim()}),
    'objectFilter': jsonEncode({
      for (final k in _stateKeys)
        if (object.containsKey(k)) k: object[k],
      if (wire != null) _treeKey: _toStored(wire),
    }),
    'uiOptions': jsonEncode({
      ...ui,
      'displayMode': _displayModeFor(list, '${ui['displayMode'] ?? ''}'),
    }),
  };
}

/// A new saved filter (Save as…): the tree, the search, the app's sort (newest first) and the view.
Json newSavedFilter(
  String name,
  Group tree, {
  required bool list,
  required String q,
}) {
  final wire = toWire(tree);
  return {
    'mode': 'videos',
    'name': name.trim(),
    'findFilter': jsonEncode({
      'q': q.trim(),
      'page': 1,
      'perPage': 40,
      'sort': 'created_at',
      'direction': 'desc',
    }),
    'objectFilter': jsonEncode(wire == null ? {} : {_treeKey: _toStored(wire)}),
    'uiOptions': jsonEncode({'displayMode': _displayModeFor(list, '')}),
  };
}
