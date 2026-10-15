// The rule tree of a Cove video filter (design 2b), and its translation to Cove's API: a filterExpression of groups
// (AND / OR / JUST_ONE / NOT) whose leaves are one-criterion VideoFilter objects. A port of the React Native client's
// features/filter/model.ts: fields, modifiers and value encodings follow Cove's web UI and server.

import 'dart:math';

import '../../api/models.dart';
import '../../utils/format.dart' show months;

enum GroupOp { all, any, one, none }

const groupLabels = {
  GroupOp.all: 'All of',
  GroupOp.any: 'Any of',
  GroupOp.one: 'Just one of',
  GroupOp.none: 'None of',
};

enum Modifier {
  equals,
  notEquals,
  greaterThan,
  lessThan,
  between,
  notBetween,
  includes,
  includesAll,
  excludes,
  excludesAll,
  isNull,
  notNull,
  matchesRegex,
  notMatchesRegex,
  underPath,
  notUnderPath,
}

enum FieldType {
  multiId,
  resolution,
  duration,
  rating,
  number,
  date,
  timestamp,
  string,
  path,
  bool,
  orientation,
}

enum LookupKind { tags, performers, studios, groups, galleries }

const fieldSections = [
  'People & tags',
  'Video',
  'Dates',
  'Counts',
  'Text',
  'Flags',
];

class Field {
  const Field(
    this.id,
    this.label,
    this.type,
    this.key,
    this.section,
    this.modifiers, [
    this.lookup,
  ]);

  final String id;
  final String label;
  final FieldType type;

  /// The VideoFilter property
  final String key;
  final String section;
  final List<Modifier> modifiers;
  final LookupKind? lookup;
}

const _string = [
  Modifier.includes,
  Modifier.excludes,
  Modifier.equals,
  Modifier.notEquals,
  Modifier.matchesRegex,
  Modifier.notMatchesRegex,
  Modifier.isNull,
  Modifier.notNull,
];
const _number = [
  Modifier.greaterThan,
  Modifier.lessThan,
  Modifier.equals,
  Modifier.notEquals,
  Modifier.between,
  Modifier.notBetween,
  Modifier.isNull,
  Modifier.notNull,
];
const _nonNullNumber = [
  Modifier.greaterThan,
  Modifier.lessThan,
  Modifier.equals,
  Modifier.notEquals,
  Modifier.between,
  Modifier.notBetween,
];
const _multiId = [
  Modifier.includes,
  Modifier.includesAll,
  Modifier.excludes,
  Modifier.excludesAll,
  Modifier.isNull,
  Modifier.notNull,
];
const _date = [
  Modifier.between,
  Modifier.greaterThan,
  Modifier.lessThan,
  Modifier.equals,
  Modifier.notEquals,
  Modifier.notBetween,
  Modifier.isNull,
  Modifier.notNull,
];
const _people = 'People & tags';

/// Cove's video criteria, without related performers, tag duration, hashes, duplicates and remote ids.
const fields = [
  Field(
    'tags',
    'Tag',
    FieldType.multiId,
    'tagsCriterion',
    _people,
    _multiId,
    LookupKind.tags,
  ),
  Field(
    'performers',
    'Performer',
    FieldType.multiId,
    'performersCriterion',
    _people,
    _multiId,
    LookupKind.performers,
  ),
  Field(
    'studios',
    'Studio',
    FieldType.multiId,
    'studiosCriterion',
    _people,
    _multiId,
    LookupKind.studios,
  ),
  Field(
    'groups',
    'Group',
    FieldType.multiId,
    'groupsCriterion',
    _people,
    _multiId,
    LookupKind.groups,
  ),
  Field(
    'galleries',
    'Gallery',
    FieldType.multiId,
    'galleriesCriterion',
    _people,
    _multiId,
    LookupKind.galleries,
  ),
  Field(
    'performerAge',
    'Performer age',
    FieldType.number,
    'performerAgeCriterion',
    _people,
    _number,
  ),
  Field(
    'resolution',
    'Resolution',
    FieldType.resolution,
    'resolutionCriterion',
    'Video',
    [
      Modifier.equals,
      Modifier.notEquals,
      Modifier.greaterThan,
      Modifier.lessThan,
    ],
  ),
  Field(
    'duration',
    'Duration',
    FieldType.duration,
    'durationCriterion',
    'Video',
    _nonNullNumber,
  ),
  Field(
    'orientation',
    'Orientation',
    FieldType.orientation,
    'orientationCriterion',
    'Video',
    [Modifier.equals, Modifier.notEquals],
  ),
  Field(
    'rating',
    'Rating',
    FieldType.rating,
    'ratingCriterion',
    'Video',
    _number,
  ),
  Field(
    'frameRate',
    'Frame rate',
    FieldType.number,
    'frameRateCriterion',
    'Video',
    _nonNullNumber,
  ),
  Field(
    'bitrate',
    'Bitrate (kbps)',
    FieldType.number,
    'bitrateInterval',
    'Video',
    _number,
  ),
  Field(
    'videoCodec',
    'Video codec',
    FieldType.string,
    'videoCodecCriterion',
    'Video',
    _string,
  ),
  Field(
    'audioCodec',
    'Audio codec',
    FieldType.string,
    'audioCodecCriterion',
    'Video',
    _string,
  ),
  Field(
    'createdAt',
    'Added',
    FieldType.timestamp,
    'createdAtCriterion',
    'Dates',
    _date,
  ),
  Field('date', 'Date', FieldType.date, 'dateCriterion', 'Dates', _date),
  Field(
    'updatedAt',
    'Updated',
    FieldType.timestamp,
    'updatedAtCriterion',
    'Dates',
    _date,
  ),
  Field(
    'lastPlayedAt',
    'Last played',
    FieldType.timestamp,
    'lastPlayedAtCriterion',
    'Dates',
    _date,
  ),
  Field(
    'playCount',
    'Play count',
    FieldType.number,
    'playCountCriterion',
    'Counts',
    _nonNullNumber,
  ),
  Field(
    'playDuration',
    'Play duration',
    FieldType.duration,
    'playDurationCriterion',
    'Counts',
    _nonNullNumber,
  ),
  Field(
    'resumeTime',
    'Resume time',
    FieldType.duration,
    'resumeTimeCriterion',
    'Counts',
    _nonNullNumber,
  ),
  Field(
    'likeCounter',
    'Likes',
    FieldType.number,
    'likeCounterCriterion',
    'Counts',
    _number,
  ),
  Field(
    'performerCount',
    'Performer count',
    FieldType.number,
    'performerCountCriterion',
    'Counts',
    _nonNullNumber,
  ),
  Field(
    'tagCount',
    'Tag count',
    FieldType.number,
    'tagCountCriterion',
    'Counts',
    _nonNullNumber,
  ),
  Field(
    'fileCount',
    'File count',
    FieldType.number,
    'fileCountCriterion',
    'Counts',
    _nonNullNumber,
  ),
  Field('title', 'Title', FieldType.string, 'titleCriterion', 'Text', _string),
  Field(
    'details',
    'Details',
    FieldType.string,
    'detailsCriterion',
    'Text',
    _string,
  ),
  Field(
    'director',
    'Director',
    FieldType.string,
    'directorCriterion',
    'Text',
    _string,
  ),
  Field(
    'code',
    'Studio code',
    FieldType.string,
    'codeCriterion',
    'Text',
    _string,
  ),
  Field('url', 'URL', FieldType.string, 'urlCriterion', 'Text', _string),
  Field(
    'captions',
    'Captions',
    FieldType.string,
    'captionsCriterion',
    'Text',
    _string,
  ),
  // Design 3a: a folder (and everything inside it), or a text match.
  Field('path', 'Path', FieldType.path, 'pathCriterion', 'Text', [
    Modifier.underPath,
    Modifier.notUnderPath,
    Modifier.includes,
    Modifier.matchesRegex,
  ]),
  Field('favorite', 'Favorite', FieldType.bool, 'favoriteCriterion', 'Flags', [
    Modifier.equals,
  ]),
  Field(
    'organized',
    'Organized',
    FieldType.bool,
    'organizedCriterion',
    'Flags',
    [Modifier.equals],
  ),
  Field('isVr', 'VR', FieldType.bool, 'isVrCriterion', 'Flags', [
    Modifier.equals,
  ]),
  Field(
    'hasSegments',
    'Has segments',
    FieldType.bool,
    'hasSegmentsCriterion',
    'Flags',
    [Modifier.equals],
  ),
];

Field fieldById(String id) =>
    fields.firstWhere((f) => f.id == id, orElse: () => fields.first);

Field? fieldByKey(String key) {
  for (final f in fields) {
    if (f.key == key) return f;
  }
  return null;
}

/// Cove's resolution buckets (the longest side's range, labelled by its usual name).
const resolutions = [
  (value: 144, label: '144p'),
  (value: 240, label: '240p'),
  (value: 360, label: '360p'),
  (value: 480, label: '480p'),
  (value: 540, label: '540p'),
  (value: 720, label: '720p'),
  (value: 1080, label: '1080p'),
  (value: 1440, label: '1440p'),
  (value: 2160, label: '4K'),
  (value: 2880, label: '5K'),
  (value: 3384, label: '6K'),
  (value: 4032, label: '7K'),
  (value: 4320, label: '8K'),
  (value: 9999, label: 'Huge'),
];

const orientations = [
  (value: 'landscape', label: 'Landscape'),
  (value: 'portrait', label: 'Portrait'),
  (value: 'square', label: 'Square'),
];

// --- The tree ---------------------------------------------------------------------------------------------------

/// The path match options of design 3a, in its order and words.
const pathLabels = {
  Modifier.underPath: 'In folder',
  Modifier.notUnderPath: 'Not in folder',
  Modifier.includes: 'Contains text',
  Modifier.matchesRegex: 'Regex',
};

bool isFolderMatch(Modifier m) =>
    m == Modifier.underPath || m == Modifier.notUnderPath;

final _seps = RegExp(r'[\\/]');
final _trailingSeps = RegExp(r'[\\/]+$');

/// The folders a path names under the library root it is in (names and paths, root first).
List<FolderRef> folderChain(String path, List<FolderRef> roots) {
  final trimmed = path.trim().replaceFirst(_trailingSeps, '');
  final lower = trimmed.toLowerCase();
  FolderRef? root;
  for (final r in roots) {
    final base = r.path.toLowerCase().replaceFirst(_trailingSeps, '');
    if (lower == r.path.toLowerCase() ||
        lower.startsWith('$base/') ||
        lower.startsWith('$base\\')) {
      root = r;
      break;
    }
  }
  if (root == null) {
    final parts = trimmed.split(_seps).where((p) => p.isNotEmpty).toList();
    return parts.isEmpty ? [] : [FolderRef(parts.last, trimmed)];
  }
  final sep = root.path.contains('\\') && !root.path.contains('/') ? '\\' : '/';
  final base = root.path.replaceFirst(_trailingSeps, '');
  final chain = [root];
  var current = base;
  for (final part in trimmed.substring(base.length).split(_seps)) {
    if (part.isEmpty) continue;
    current = '$current$sep$part';
    chain.add(FolderRef(part, current));
  }
  return chain;
}

/// "Drone/2024": the folder's last two names (the root's own name when it is a root).
String _shortFolder(Condition c) {
  final chain = c.folder?.chain;
  if (chain != null && chain.isNotEmpty) {
    final below = chain.length > 1 ? chain.sublist(1) : chain;
    return below.skip(max(0, below.length - 2)).map((f) => f.name).join('/');
  }
  final parts = '${c.value}'.split(_seps).where((p) => p.isNotEmpty).toList();
  return parts.skip(max(0, parts.length - 2)).join('/');
}

/// A library folder (Cove's library-folders).
class FolderRef {
  const FolderRef(this.name, this.path);

  final String name;
  final String path;
}

sealed class Node {
  const Node(this.id);

  final String id;
}

class Condition extends Node {
  const Condition({
    required String id,
    required this.field,
    required this.modifier,
    required this.value,
    this.value2,
    this.names = const {},
    this.folder,
  }) : super(id);

  final String field;
  final Modifier modifier;

  /// multiId: List<int> ids · resolution: bucket · duration: minutes · rating: stars · number · date/timestamp:
  /// "yyyy-mm-dd" or relative ("-7d") · string · bool · orientation
  final Object value;
  final Object? value2;

  /// multiId: names of the ids, for display
  final Map<int, String> names;

  /// path in a folder: the folders from the library root down to it, and how many subfolders it has
  final ({List<FolderRef> chain, int subfolders})? folder;

  List<int> get ids => value is List ? (value as List).cast<int>() : const [];

  Condition copyWith({
    String? id,
    String? field,
    Modifier? modifier,
    Object? value,
    Object? value2,
    Map<int, String>? names,
    ({List<FolderRef> chain, int subfolders})? folder,
    bool clearFolder = false,
  }) => Condition(
    id: id ?? this.id,
    field: field ?? this.field,
    modifier: modifier ?? this.modifier,
    value: value ?? this.value,
    value2: value2 ?? this.value2,
    names: names ?? this.names,
    folder: clearFolder ? null : (folder ?? this.folder),
  );
}

class Group extends Node {
  const Group({required String id, required this.op, required this.children})
    : super(id);

  final GroupOp op;
  final List<Node> children;

  Group copyWith({String? id, GroupOp? op, List<Node>? children}) => Group(
    id: id ?? this.id,
    op: op ?? this.op,
    children: children ?? this.children,
  );
}

int _nextId = 0;
String newId() => 'n${++_nextId}';

Group emptyTree() => Group(id: newId(), op: GroupOp.all, children: const []);

GroupOp nextOp(GroupOp op) =>
    GroupOp.values[(op.index + 1) % GroupOp.values.length];

/// The tree with the node of that id replaced (or removed, with null).
Group replaceNode(Group root, String id, Node? next) {
  if (root.id == id && next is Group) return next;
  Group walk(Group group) => group.copyWith(
    children: [
      for (final child in group.children)
        if (child.id == id) ...[
          ?next,
        ] else if (child is Group)
          walk(child)
        else
          child,
    ],
  );
  return walk(root);
}

/// The tree with node appended to the group of that id.
Group appendTo(Group root, String groupId, Node node) {
  if (root.id == groupId)
    return root.copyWith(children: [...root.children, node]);
  return root.copyWith(
    children: [
      for (final child in root.children)
        child is Group ? appendTo(child, groupId, node) : child,
    ],
  );
}

int conditionCount(Group group) =>
    group.children.fold(0, (n, c) => n + (c is Group ? conditionCount(c) : 1));

// --- Editing the tree (design 4a–4c): cut / copy / paste, wrap, ungroup ------------------------------------------

Node? findNode(Group root, String id) {
  if (root.id == id) return root;
  for (final child in root.children) {
    if (child.id == id) return child;
    if (child is Group) {
      final found = findNode(child, id);
      if (found != null) return found;
    }
  }
  return null;
}

/// The group holding the node of that id, and the node's position in it (null for the root or an unknown id).
({Group parent, int index})? findParent(Group root, String id) {
  final index = root.children.indexWhere((c) => c.id == id);
  if (index >= 0) return (parent: root, index: index);
  for (final child in root.children) {
    if (child is Group) {
      final found = findParent(child, id);
      if (found != null) return found;
    }
  }
  return null;
}

/// Whether id is node itself or anything inside it.
bool nodeContains(Node node, String id) =>
    node.id == id ||
    (node is Group && node.children.any((c) => nodeContains(c, id)));

Group removeNode(Group root, String id) => replaceNode(root, id, null);

/// The tree with node placed right before or after the node of that id.
Group insertRelative(
  Group root,
  String targetId,
  Node node, {
  required bool before,
}) {
  Group walk(Group group) => group.copyWith(
    children: [
      for (final child in group.children)
        ...() {
          final self = child is Group ? walk(child) : child;
          if (child.id != targetId) return [self];
          return before ? [node, self] : [self, node];
        }(),
    ],
  );
  return walk(root);
}

/// The node replaced by a new All of group holding it; for the root, a new root around it.
Group wrapNode(Group root, String id) {
  Group wrap(Node node) =>
      Group(id: newId(), op: GroupOp.all, children: [node]);
  if (root.id == id) return wrap(root);
  final node = findNode(root, id);
  return node == null ? root : replaceNode(root, id, wrap(node));
}

/// The group's children in its place, in its parent, and the group gone.
Group ungroup(Group root, String groupId) {
  Group walk(Group group) => group.copyWith(
    children: [
      for (final child in group.children)
        if (child is! Group)
          child
        else if (child.id == groupId)
          ...child.children
        else
          walk(child),
    ],
  );
  return walk(root);
}

/// A deep copy with new ids (what Copy pastes).
T cloneNode<T extends Node>(T node) => switch (node) {
  Condition() => node.copyWith(id: newId()) as T,
  Group() => node.copyWith(
    id: newId(),
    children: [for (final c in node.children) cloneNode(c)],
  ) as T,
};

/// A node in a few words: "Tag includes Drone", "Any of · 2 conditions".
String summary(Node node) {
  if (node is Group) {
    final count = conditionCount(node);
    return '${groupLabels[node.op]} · $count condition${count == 1 ? '' : 's'}';
  }
  final row = rowText(node as Condition);
  final line = row.runs
      .map(
        (r) => r.folder
            ? ''
            : r.sep
            ? '›'
            : r.text,
      )
      .join()
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  return '${row.label} $line';
}

/// What the clipboard holds: a cut node (pasting moves it) or a copied one (each paste is a new copy).
class Clipboard {
  const Clipboard(this.node, {required this.cut});

  final Node node;
  final bool cut;
}

/// Whether the clipboard can go at a target: never into, before or after a cut node itself or its inside.
bool canPaste(Clipboard? clipboard, String targetId) =>
    clipboard != null &&
    !(clipboard.cut && nodeContains(clipboard.node, targetId));

/// Where a paste goes: into a group (at its end), or before / after a node.
sealed class PasteTarget {
  const PasteTarget(this.id);
  final String id;
}

class PasteInto extends PasteTarget {
  const PasteInto(super.id);
}

class PasteAt extends PasteTarget {
  const PasteAt(super.id, {required this.before});
  final bool before;
}

/// The tree with the clipboard pasted. A cut node moves there (it leaves its old place); a copy goes in as a new copy.
Group paste(Group root, Clipboard clipboard, PasteTarget target) {
  if (!canPaste(clipboard, target.id)) return root;
  // A cut node as it is now (it may have been edited since it was cut).
  final node = clipboard.cut
      ? (findNode(root, clipboard.node.id) ?? clipboard.node)
      : cloneNode(clipboard.node);
  final base = clipboard.cut ? removeNode(root, clipboard.node.id) : root;
  return switch (target) {
    PasteInto(:final id) => appendTo(base, id, node),
    PasteAt(:final id, :final before) => insertRelative(
      base,
      id,
      node,
      before: before,
    ),
  };
}

// --- Deep trees (design 5a–5f): levels, Simplify ------------------------------------------------------------------

/// The groups from the root down to the group of that id, both included (null if it isn't a group in the tree).
List<Group>? findChain(Group root, String id) {
  if (root.id == id) return [root];
  for (final child in root.children) {
    if (child is Group) {
      final chain = findChain(child, id);
      if (chain != null) return [root, ...chain];
    }
  }
  return null;
}

int _groupCount(Group group) =>
    group.children.fold(1, (n, c) => n + (c is Group ? _groupCount(c) : 0));

/// The tree without groups that change nothing, their items merged into the parent: an empty group, a group of one
/// (not None of), an All of in an All of, an Any of in an Any of; and a root holding just one group (unless None of).
Group simplify(Group root) {
  Group walk(Group group) => group.copyWith(
    children: [
      for (final child in group.children)
        ...() {
          if (child is! Group) return [child];
          final g = walk(child);
          if (g.children.isEmpty) return const <Node>[];
          if (g.children.length == 1 && g.op != GroupOp.none) return g.children;
          if (g.op == group.op &&
              (g.op == GroupOp.all || g.op == GroupOp.any)) {
            return g.children;
          }
          return [g];
        }(),
    ],
  );
  var next = root;
  for (;;) {
    var step = walk(next);
    final only = step.children.firstOrNull;
    if (step.op != GroupOp.none && step.children.length == 1 && only is Group) {
      step = only;
    }
    if (_groupCount(step) == _groupCount(next)) return step;
    next = step;
  }
}

/// How many groups Simplify would merge away.
int simplifiable(Group root) => _groupCount(root) - _groupCount(simplify(root));

// --- Cove's wire format ---------------------------------------------------------------------------------------

const _noValue = [Modifier.isNull, Modifier.notNull];
const _twoValues = [Modifier.between, Modifier.notBetween];

bool needsValue(Modifier m) => !_noValue.contains(m);
bool needsTwoValues(Modifier m) => _twoValues.contains(m);

num _num(Object? v) => v is num ? v : num.tryParse('$v') ?? double.nan;

Json _criterion(Condition c) {
  final f = fieldById(c.field);
  final empty = _noValue.contains(c.modifier);
  final two = _twoValues.contains(c.modifier);
  int scaled(Object? v, [num scale = 1]) {
    final n = _num(v) * scale;
    return n.isFinite ? n.round() : 0;
  }

  Json numeric(num scale) => {
    'value': empty ? 0 : scaled(c.value, scale),
    if (two) 'value2': scaled(c.value2, scale),
    'modifier': c.modifier.name,
  };
  return switch (f.type) {
    FieldType.multiId => {
      'value': empty ? <int>[] : c.ids,
      'modifier': c.modifier.name,
    },
    FieldType.bool => {'value': c.value == true},
    FieldType.duration => numeric(60),
    FieldType.rating => numeric(20),
    FieldType.number || FieldType.resolution => numeric(1),
    FieldType.date || FieldType.timestamp => {
      'value': empty ? '' : '${c.value}'.trim(),
      if (two) 'value2': '${c.value2 ?? ''}'.trim(),
      'modifier': c.modifier.name,
    },
    _ => {'value': empty ? '' : '${c.value}', 'modifier': c.modifier.name},
  };
}

Json? _nodeToWire(Node node) => switch (node) {
  Condition() => {
    'filter': {fieldById(node.field).key: _criterion(node)},
  },
  Group() => switch (_groupToWire(node)) {
    final g? => {'group': g},
    null => null,
  },
};

Json? _groupToWire(Group group) {
  final children = group.children.map(_nodeToWire).nonNulls.toList();
  if (children.isEmpty) return null; // Cove rejects empty groups
  return switch (group.op) {
    GroupOp.all => {'operator': 'AND', 'children': children},
    GroupOp.any => {'operator': 'OR', 'children': children},
    GroupOp.one => {'operator': 'JUST_ONE', 'children': children},
    // NOT takes one child: "none of a, b" = NOT (a OR b)
    GroupOp.none => {
      'operator': 'NOT',
      'children': children.length == 1
          ? children
          : [
              {
                'group': {'operator': 'OR', 'children': children},
              },
            ],
    },
  };
}

/// The filterExpression for Cove's videos/find, or null when the tree has no conditions.
Json? toWire(Group root) => _groupToWire(root);

// --- Relative dates (Cove's syntax: -7d, -1y3m, +2w, 0d) ------------------------------------------------------

typedef _Part = ({int amount, String unit});

({String sign, List<_Part> parts})? parseRelative(
  String value,
  bool allowHours,
) {
  final match = RegExp(
    r'^([+-]?)((?:\d+[ymwdh])+)$',
    caseSensitive: false,
  ).firstMatch(value.trim());
  if (match == null) return null;
  const ranks = {'y': 5, 'm': 4, 'w': 3, 'd': 2, 'h': 1};
  final parts = <_Part>[];
  var previous = 1 << 30;
  for (final m in RegExp(
    r'(\d+)([ymwdh])',
    caseSensitive: false,
  ).allMatches(match[2]!)) {
    final unit = m[2]!.toLowerCase();
    if ((!allowHours && unit == 'h') || ranks[unit]! >= previous) return null;
    parts.add((amount: int.parse(m[1]!), unit: unit));
    previous = ranks[unit]!;
  }
  final sign = match[1]!;
  if (sign.isEmpty &&
      (parts.length != 1 || parts[0].amount != 0 || parts[0].unit != 'd')) {
    return null;
  }
  return (sign: sign, parts: parts);
}

bool isRelative(Object? value) =>
    value is String &&
    RegExp(r'^[+-]|^0d$', caseSensitive: false).hasMatch(value.trim());

/// Resolves an exact or relative date to a DateTime (UTC, relative to now), or null.
DateTime? resolveDate(String value, bool allowHours) {
  final relative = parseRelative(value, allowHours);
  if (relative == null) {
    if (!RegExp(r'^\d{4}-\d{2}-\d{2}').hasMatch(value.trim())) return null;
    return DateTime.tryParse(value.trim())?.toUtc();
  }
  var result = DateTime.now().toUtc();
  final sign = relative.sign == '-' ? -1 : 1;
  for (final part in relative.parts) {
    final amount = sign * part.amount;
    switch (part.unit) {
      case 'h':
        result = result.add(Duration(hours: amount));
      case 'd' || 'w':
        result = result.add(
          Duration(days: amount * (part.unit == 'w' ? 7 : 1)),
        );
      default:
        final day = result.day;
        final y = result.year + (part.unit == 'y' ? amount : 0);
        final m = result.month + (part.unit == 'm' ? amount : 0);
        final first = DateTime.utc(
          y,
          m,
          1,
          result.hour,
          result.minute,
          result.second,
        );
        final last = DateTime.utc(first.year, first.month + 1, 0).day;
        result = DateTime.utc(
          first.year,
          first.month,
          min(day, last),
          result.hour,
          result.minute,
          result.second,
        );
    }
  }
  return result;
}

String _formatDay(String value, bool allowHours) {
  if (RegExp(r'^0d$', caseSensitive: false).hasMatch(value.trim()))
    return 'today';
  final date = resolveDate(value, allowHours);
  if (date == null) return value;
  return '${months[date.month - 1]} ${date.day}, ${date.year}';
}

/// "-1y" -> "1 year ago", "0d" -> "today", "+2w" -> "in 2 weeks"
String? _relativePhrase(String value) {
  final relative = parseRelative(value, true);
  if (relative == null) return null;
  if (relative.sign.isEmpty) return 'today';
  const unitNames = {
    'y': 'year',
    'm': 'month',
    'w': 'week',
    'd': 'day',
    'h': 'hour',
  };
  final text = relative.parts
      .map((p) => '${p.amount} ${unitNames[p.unit]}${p.amount == 1 ? '' : 's'}')
      .join(' ');
  return relative.sign == '-' ? '$text ago' : 'in $text';
}

// --- Plain language -------------------------------------------------------------------------------------------

String _list(List<String> values, String joiner) {
  if (values.length <= 1) return values.firstOrNull ?? '';
  return '${values.sublist(0, values.length - 1).join(', ')} $joiner ${values.last}';
}

List<String> _names(Condition c) => [
  for (final id in c.ids) c.names[id] ?? '#$id',
];

String _minutes(Object? v) {
  final n = _num(v);
  if (n >= 60 && n % 60 == 0) return '${_trim(n / 60)} h';
  return '${_trim(n)} min';
}

/// 20.0 -> "20", 2.5 -> "2.5"
String _trim(num n) => n == n.roundToDouble() ? '${n.round()}' : '$n';

/// A value as the rows and the sentence show it.
String valueText(Condition c, [int which = 1]) {
  final f = fieldById(c.field);
  final v = which == 1 ? c.value : c.value2;
  return switch (f.type) {
    FieldType.multiId => _names(c).join(', '),
    FieldType.resolution =>
      resolutions.where((r) => r.value == _num(v)).firstOrNull?.label ?? '$v',
    FieldType.duration => _minutes(v),
    FieldType.rating => '${v is num ? _trim(v) : v}★',
    FieldType.bool => v == true ? 'yes' : 'no',
    FieldType.orientation =>
      orientations
              .where((o) => o.value == v)
              .firstOrNull
              ?.label
              .toLowerCase() ??
          '$v',
    FieldType.string || FieldType.path => '“$v”',
    FieldType.number => v is num ? _trim(v) : '${v ?? ''}',
    _ => '${v ?? ''}',
  };
}

const _multiVerb = {
  // (with these, plural noun)
  LookupKind.tags: ('tagged', 'tags'),
  LookupKind.performers: ('with', 'performers'),
  LookupKind.studios: ('from', 'studio'),
  LookupKind.groups: ('in', 'groups'),
  LookupKind.galleries: ('in', 'galleries'),
};

const _dateVerb = {
  'createdAt': 'added',
  'date': 'dated',
  'updatedAt': 'updated',
  'lastPlayedAt': 'last played',
};

String _dateValue(Object? v) {
  final s = '${v ?? ''}';
  return _relativePhrase(s) ?? _formatDay(s, true);
}

/// One condition in plain words: "tagged Drone and Landscape", "added in the last year", "over 20 min".
String describeCondition(Condition c) {
  final f = fieldById(c.field);
  final m = c.modifier;
  // The Library's built-in shortcuts: play count 0, a resume position
  if (f.id == 'playCount' && m == Modifier.equals && _num(c.value) == 0)
    return 'unwatched';
  if (f.id == 'resumeTime' && m == Modifier.greaterThan && _num(c.value) == 0) {
    return 'in progress';
  }
  if (f.type == FieldType.path) {
    // Design 3c / 5a: "in Drone/2024", "not in Family", "“GoPro” in path"
    switch (m) {
      case Modifier.underPath:
        return 'in ${_shortFolder(c)}';
      case Modifier.notUnderPath:
        return 'not in ${_shortFolder(c)}';
      case Modifier.includes:
        return '“${c.value}” in path';
      case Modifier.matchesRegex:
        return 'with a path matching ${c.value}';
      default:
    }
  }
  if (f.type == FieldType.multiId && f.lookup != null) {
    final (verb, plural) = _multiVerb[f.lookup]!;
    final n = _names(c);
    return switch (m) {
      Modifier.includes => '$verb ${_list(n, 'or')}',
      Modifier.includesAll => '$verb ${_list(n, 'and')}',
      Modifier.excludes => 'not $verb ${_list(n, 'or')}',
      Modifier.excludesAll => 'not $verb all of ${_list(n, 'and')}',
      Modifier.isNull => 'with no $plural',
      _ => 'with any $plural',
    };
  }
  if (f.type == FieldType.date || f.type == FieldType.timestamp) {
    final verb = _dateVerb[f.id] ?? f.label.toLowerCase();
    final a = '${c.value}';
    final b = '${c.value2 ?? ''}';
    switch (m) {
      case Modifier.between:
        // "-1y" … "0d": "in the last year"
        final since = parseRelative(a, true);
        if (since?.sign == '-' &&
            RegExp(r'^0d$', caseSensitive: false).hasMatch(b.trim())) {
          final phrase = _relativePhrase(a)!.replaceFirst(RegExp(r' ago$'), '');
          return '$verb in the last ${phrase.replaceFirst(RegExp(r'^1 '), '')}';
        }
        return '$verb between ${_dateValue(a)} and ${_dateValue(b)}';
      case Modifier.notBetween:
        return 'not $verb between ${_dateValue(a)} and ${_dateValue(b)}';
      case Modifier.greaterThan:
        return '$verb after ${_dateValue(a)}';
      case Modifier.lessThan:
        return '$verb before ${_dateValue(a)}';
      case Modifier.equals:
        return '$verb on ${_dateValue(a)}';
      case Modifier.notEquals:
        return 'not $verb on ${_dateValue(a)}';
      case Modifier.isNull:
        return f.id == 'lastPlayedAt'
            ? 'never played'
            : 'with no ${f.label.toLowerCase()}';
      default:
        return f.id == 'lastPlayedAt'
            ? 'played before'
            : 'with a ${f.label.toLowerCase()}';
    }
  }
  if (f.type == FieldType.resolution) {
    final v = valueText(c);
    return switch (m) {
      Modifier.notEquals => 'not $v',
      Modifier.greaterThan => 'above $v',
      Modifier.lessThan => 'below $v',
      _ => v,
    };
  }
  if (f.type == FieldType.duration && f.id == 'duration') {
    final a = valueText(c), b = valueText(c, 2);
    return switch (m) {
      Modifier.greaterThan => 'over $a',
      Modifier.lessThan => 'under $a',
      Modifier.between => '$a–$b long',
      Modifier.notBetween => 'not $a–$b long',
      Modifier.notEquals => 'not $a long',
      _ => '$a long',
    };
  }
  if (f.type == FieldType.bool) {
    return c.value == true
        ? f.label.toLowerCase()
        : 'not ${f.label.toLowerCase()}';
  }
  if (f.type == FieldType.orientation) {
    return m == Modifier.notEquals ? 'not ${valueText(c)}' : valueText(c);
  }
  // Cove's own phrasing (filterExpressionExplanation.ts), with a lowercase field
  final label = f.label.toLowerCase();
  final a = valueText(c), b = valueText(c, 2);
  return switch (m) {
    Modifier.equals => '$label is $a',
    Modifier.notEquals => '$label is not $a',
    Modifier.greaterThan => '$label is greater than $a',
    Modifier.lessThan => '$label is less than $a',
    Modifier.between => '$label is between $a and $b',
    Modifier.notBetween => '$label is not between $a and $b',
    Modifier.includes => '$label includes $a',
    Modifier.excludes => '$label excludes $a',
    Modifier.matchesRegex => '$label matches the pattern $a',
    Modifier.notMatchesRegex => '$label does not match the pattern $a',
    Modifier.isNull => '$label is not set',
    Modifier.notNull => '$label is set',
    Modifier.underPath => '$label is under $a',
    Modifier.notUnderPath => '$label is not under $a',
    _ => '$label $a',
  };
}

// --- The summary (design 5a): at most three short lines ------------------------------------------------------------

/// A piece of a summary line: the operator lead, a joining word, text, a group token (opens that group), "+ N more".
sealed class SummaryRun {
  const SummaryRun();
}

class LeadRun extends SummaryRun {
  const LeadRun(this.text);
  final String text;
}

class WordRun extends SummaryRun {
  const WordRun(this.text);
  final String text;
}

class TextRun extends SummaryRun {
  const TextRun(this.text);
  final String text;
}

class GroupRun extends SummaryRun {
  const GroupRun(this.group, this.text);
  final Group group;
  final String text;
}

class MoreRun extends SummaryRun {
  const MoreRun(this.count);
  final int count;
}

// About what fits on one 13.5px line of a phone; a token counts its icon and padding.
const _lineBudget = 48;
const _repeatable = ['tagged', 'with', 'from', 'in', 'added', 'over', 'under'];
const _lineWords = {
  GroupOp.all: 'and',
  GroupOp.any: 'or',
  GroupOp.one: 'or',
  GroupOp.none: 'nor',
};

int _runsLength(List<SummaryRun> runs) => runs.fold(
  0,
  (n, r) =>
      n +
      switch (r) {
        MoreRun() => 8,
        GroupRun(:final text) => text.length + 5,
        LeadRun(:final text) ||
        WordRun(:final text) ||
        TextRun(:final text) => text.length,
      },
);

/// A group as a token: "all of 5".
GroupRun groupToken(Group group) => GroupRun(
  group,
  '${groupLabels[group.op]!.toLowerCase()} ${conditionCount(group)}',
);

/// "a, b or c", with each part a list of runs.
List<SummaryRun> _listRuns(List<List<SummaryRun>> parts, String joiner) => [
  for (final (i, p) in parts.indexed) ...[
    if (i > 0) TextRun(i == parts.length - 1 ? ' $joiner ' : ', '),
    ...p,
  ],
];

/// A group spelled out one level down: its conditions in words, its own subgroups as tokens.
List<SummaryRun> groupPhrase(Group group) {
  var verb = '';
  final parts = <List<SummaryRun>>[];
  for (final c in group.children) {
    if (c is Group) {
      verb = '';
      if (conditionCount(c) > 0) parts.add([groupToken(c)]);
      continue;
    }
    // "tagged Blurry nor Rejected": a verb the previous condition just used goes
    final phrase = describeCondition(c as Condition);
    final first = phrase.split(' ').first;
    final repeated = first == verb && _repeatable.contains(first);
    verb = first;
    parts.add([
      TextRun(repeated ? phrase.substring(first.length + 1) : phrase),
    ]);
  }
  if (parts.isEmpty) return [];
  if (parts.length == 1) {
    return group.op == GroupOp.none
        ? [const TextRun('not '), ...parts[0]]
        : parts[0];
  }
  return switch (group.op) {
    GroupOp.all => _listRuns(parts, 'and'),
    GroupOp.any => _listRuns(parts, 'or'),
    GroupOp.one =>
      parts.length == 2
          ? [
              const TextRun('either '),
              ...parts[0],
              const TextRun(' or '),
              ...parts[1],
              const TextRun(', not both'),
            ]
          : [const TextRun('exactly one of '), ..._listRuns(parts, 'or')],
    GroupOp.none =>
      parts.length == 2
          ? [
              const TextRun('neither '),
              ...parts[0],
              const TextRun(' nor '),
              ...parts[1],
            ]
          : [const TextRun('none of '), ..._listRuns(parts, 'or')],
  };
}

/// Runs as plain text (tokens by their words).
String runsText(List<SummaryRun> runs) => runs
    .map(
      (r) => switch (r) {
        MoreRun(:final count) => '+ $count more',
        GroupRun(:final text) ||
        LeadRun(:final text) ||
        WordRun(:final text) ||
        TextRun(:final text) => text,
      },
    )
    .join();

/// A group as its summary lines (design 5a): its conditions on the first line after its operator ("All of: tagged
/// Drone · 4K"); a line per subgroup, starting with the group's word ("and 4K or {all of 5}"); deeper groups as tokens.
/// Short of `full`, three lines at most: whole items that don't fit fold into "+ N more", never mid-phrase.
List<List<SummaryRun>> outline(Group group, {bool full = false}) {
  var more = 0;
  final first = <SummaryRun>[LeadRun('${groupLabels[group.op]}:')];
  var conditions = 0;
  for (final c in group.children) {
    if (c is! Condition) continue;
    final piece = TextRun(
      '${conditions > 0 ? ' · ' : ' '}${describeCondition(c)}',
    );
    if (!full &&
        conditions > 0 &&
        _runsLength(first) + _runsLength([piece]) > _lineBudget) {
      more++;
    } else {
      first.add(piece);
      conditions++;
    }
  }
  final lines = [first];
  var firstTaken = conditions > 0;
  for (final g in group.children) {
    if (g is! Group || conditionCount(g) == 0) continue;
    var phrase = groupPhrase(g);
    if (!full && _runsLength(phrase) + 4 > _lineBudget)
      phrase = [groupToken(g)];
    if (!firstTaken) {
      first.addAll([const TextRun(' '), ...phrase]);
    } else {
      lines.add([WordRun('${_lineWords[group.op]} '), ...phrase]);
    }
    firstTaken = true;
  }
  if (first.length == 1) return [];
  if (full) return lines;
  if (lines.length > 3) {
    more += lines.length - 3;
    lines.removeRange(3, lines.length);
  }
  if (more > 0) {
    final last = lines.last;
    if (_runsLength(last) + 11 <= _lineBudget) {
      last.addAll([const TextRun(' · '), MoreRun(more)]);
    } else if (lines.length < 3) {
      lines.add([MoreRun(more)]);
    } else {
      lines[2] = [MoreRun(more + 1)];
    }
  }
  return lines;
}

// --- Rows -----------------------------------------------------------------------------------------------------

const modifierLabels = {
  Modifier.equals: 'is',
  Modifier.notEquals: 'is not',
  Modifier.greaterThan: 'greater than',
  Modifier.lessThan: 'less than',
  Modifier.between: 'between',
  Modifier.notBetween: 'not between',
  Modifier.includes: 'includes',
  Modifier.includesAll: 'includes all',
  Modifier.excludes: 'excludes',
  Modifier.excludesAll: 'excludes all',
  Modifier.isNull: 'is not set',
  Modifier.notNull: 'is set',
  Modifier.matchesRegex: 'matches regex',
  Modifier.notMatchesRegex: "doesn't match regex",
  Modifier.underPath: 'is under',
  Modifier.notUnderPath: 'is not under',
};

/// Operators as 2b's rows show them: "=" for single values, words otherwise.
String _rowOperator(Field f, Modifier m) {
  final words =
      f.type == FieldType.multiId ||
      f.type == FieldType.string ||
      f.type == FieldType.path;
  if (m == Modifier.equals && !words) return '=';
  if (m == Modifier.notEquals && !words) return '≠';
  return modifierLabels[m]!;
}

/// A run of a row's second line: muted (operator words), mono (relative dates, path text) or plain (values); folder:
/// a folder icon, sep: a caret between folder names.
class RowRun {
  const RowRun(
    this.text, {
    this.muted = false,
    this.mono = false,
    this.folder = false,
    this.sep = false,
  });

  final String text;
  final bool muted;
  final bool mono;
  final bool folder;
  final bool sep;
}

typedef RowText = ({
  String label,
  List<RowRun> runs,
  String? resolved,
  bool resolvedMono,
});

/// A condition row: field label, "operator value" runs, and a resolved date range for relative dates.
RowText rowText(Condition c) {
  final f = fieldById(c.field);
  if (f.type == FieldType.path) {
    // Design 3c: "in folder" + folder + its last names, the full path below.
    if (isFolderMatch(c.modifier)) {
      final chain = c.folder?.chain;
      final List<String> shown;
      if (chain != null && chain.isNotEmpty) {
        final below = chain.length > 1 ? chain.sublist(1) : chain;
        shown = below
            .skip(max(0, below.length - 2))
            .map((x) => x.name)
            .toList();
      } else {
        shown = _shortFolder(c).split('/');
      }
      final runs = <RowRun>[
        RowRun(
          c.modifier == Modifier.underPath ? 'in folder' : 'not in folder',
          muted: true,
        ),
        const RowRun(' '),
        const RowRun('', folder: true),
        const RowRun(' '),
      ];
      for (final (i, name) in shown.indexed) {
        if (i > 0)
          runs.addAll(const [RowRun(' '), RowRun('', sep: true), RowRun(' ')]);
        runs.add(RowRun(name));
      }
      final subfolders = c.folder?.subfolders ?? 0;
      return (
        label: f.label,
        runs: runs,
        resolved:
            '${c.value}${subfolders > 0 ? ' · and $subfolders subfolder${subfolders == 1 ? '' : 's'}' : ''}',
        resolvedMono: true,
      );
    }
    // Text matches (and any other operator a condition may carry).
    final words = c.modifier == Modifier.includes
        ? 'contains'
        : modifierLabels[c.modifier]!;
    return (
      label: f.label,
      runs: needsValue(c.modifier)
          ? [
              RowRun(words, muted: true),
              const RowRun(' '),
              RowRun('${c.value}', mono: true),
            ]
          : [RowRun(words, muted: true)],
      resolved: null,
      resolvedMono: false,
    );
  }
  final op = _rowOperator(f, c.modifier);
  if (_noValue.contains(c.modifier)) {
    return (
      label: f.label,
      runs: [RowRun(op, muted: true)],
      resolved: null,
      resolvedMono: false,
    );
  }
  if (f.type == FieldType.bool) {
    return (
      label: f.label,
      runs: [const RowRun('=', muted: true), RowRun(' ${valueText(c)}')],
      resolved: null,
      resolvedMono: false,
    );
  }
  final dated = f.type == FieldType.date || f.type == FieldType.timestamp;
  RowRun run(int which) {
    final raw = which == 1 ? c.value : c.value2;
    if (dated && isRelative(raw)) return RowRun('$raw', mono: true);
    return RowRun(dated ? '${raw ?? ''}' : valueText(c, which));
  }

  final runs = [RowRun(op, muted: true), const RowRun(' '), run(1)];
  if (_twoValues.contains(c.modifier))
    runs.addAll([const RowRun(' and ', muted: true), run(2)]);
  String? resolved;
  if (dated && (isRelative(c.value) || isRelative(c.value2))) {
    final allowHours = f.type == FieldType.timestamp;
    final a = _formatDay('${c.value}', allowHours);
    resolved = _twoValues.contains(c.modifier)
        ? '$a – ${_formatDay('${c.value2 ?? ''}', allowHours)}'
        : a;
  }
  return (label: f.label, runs: runs, resolved: resolved, resolvedMono: false);
}

// --- Editing --------------------------------------------------------------------------------------------------

/// A new condition for a field, with its first modifier and a default value.
Condition newCondition(String fieldId) {
  final f = fieldById(fieldId);
  Condition base(Object value, {Object? value2, Modifier? modifier}) =>
      Condition(
        id: newId(),
        field: f.id,
        modifier: modifier ?? f.modifiers.first,
        value: value,
        value2: value2,
      );
  return switch (f.type) {
    FieldType.multiId => base(const <int>[]),
    FieldType.resolution => base(2160, modifier: Modifier.equals),
    FieldType.duration => base(20, value2: 60),
    FieldType.rating => base(3, value2: 5),
    FieldType.number => base(0, value2: 0),
    FieldType.date || FieldType.timestamp => base('-1y', value2: '0d'),
    FieldType.bool => base(true),
    FieldType.orientation => base('landscape'),
    FieldType.path => base('', modifier: Modifier.underPath),
    FieldType.string => base(''),
  };
}

/// Why the condition can't be used yet, or null when it's complete.
String? validate(Condition c) {
  final f = fieldById(c.field);
  if (!needsValue(c.modifier)) return null;
  final two = needsTwoValues(c.modifier);
  bool finite(Object? v) => v != null && v != '' && _num(v).isFinite;
  switch (f.type) {
    case FieldType.multiId:
      return c.ids.isNotEmpty
          ? null
          : 'Pick at least one ${f.label.toLowerCase()}.';
    case FieldType.duration || FieldType.rating || FieldType.number:
      return !finite(c.value) || (two && !finite(c.value2))
          ? 'Enter a number.'
          : null;
    case FieldType.date || FieldType.timestamp:
      bool ok(Object? v) =>
          v is String && resolveDate(v, f.type == FieldType.timestamp) != null;
      return !ok(c.value) || (two && !ok(c.value2))
          ? 'Use a date (2025-10-04) or a relative date (-7d, -1y3m, 0d).'
          : null;
    case FieldType.string || FieldType.path:
      if (f.type == FieldType.path && isFolderMatch(c.modifier)) {
        return '${c.value}'.trim().isNotEmpty ? null : 'Choose a folder.';
      }
      if ('${c.value}'.trim().isEmpty) return 'Enter some text.';
      if (c.modifier == Modifier.matchesRegex ||
          c.modifier == Modifier.notMatchesRegex) {
        try {
          RegExp('${c.value}');
        } catch (_) {
          return 'That is not a valid regular expression.';
        }
      }
      return null;
    default:
      return null;
  }
}
