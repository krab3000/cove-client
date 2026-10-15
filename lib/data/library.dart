import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/widgets.dart';

import '../api/cove_client.dart';
import '../features/filter/model.dart';
import '../features/filter/saved.dart';
import '../ui/icons.dart';
import '../utils/format.dart';

/// Videos per page asked of Cove.
const perPage = 40;

/// How many videos the player gets as Up next.
const upNextCount = 20;

/// The built-in shortcuts (the sidebar's Watch, the Show sheet's Quick): real Cove criteria, a resume position and a
/// play count of 0, as one-condition filters.
enum Quick {
  progress(
    'Continue watching',
    'In progress',
    Phosphor.playCircle,
    'resumeTime',
    Modifier.greaterThan,
  ),
  unwatched(
    'Unwatched',
    'Unwatched',
    Phosphor.eyeSlash,
    'playCount',
    Modifier.equals,
  );

  const Quick(
    this.label,
    this.sheetLabel,
    this.icon,
    this.field,
    this.modifier,
  );

  // The sidebar's words, and the Show sheet's
  final String label;
  final String sheetLabel;
  final IconData icon;
  final String field;
  final Modifier modifier;

  Condition condition() =>
      Condition(id: newId(), field: field, modifier: modifier, value: 0);

  /// Whether a tree is just this shortcut.
  bool matches(Group tree) {
    if (tree.children.length != 1) return false;
    final only = tree.children.single;
    return only is Condition &&
        only.field == field &&
        only.modifier == modifier &&
        only.value is num &&
        (only.value as num) == 0;
  }
}

/// A saved filter as loaded: the filter and how it reads (its tree, its query, its search and view).
typedef Saved = ({SavedFilter filter, LoadedFilter loaded});

String _key(Json? wire) => jsonEncode(wire);

/// The Library's list: what is shown (the applied filter tree, the saved filter it came from, a search, an order) and
/// its videos, page by page as the grid reaches them; the count line's numbers; the saved filters and their counts.
class Library extends ChangeNotifier {
  Library(this.client);

  final CoveClient client;

  Group _tree = emptyTree();
  Saved? _savedFilter;
  String _q = '';
  int? _seed;

  final _pages = <int, List<Video>>{};
  final _loading = <int>{};
  final _failed = <int>{};
  int? _total;
  String _error = '';
  // Bumped whenever the list changes: answers for an older list are dropped
  int _generation = 0;
  Aggregate? _aggregate;

  List<SavedFilter> _saved = const [];
  final _savedCounts = <int, int>{};
  int? _allCount;
  bool _disposed = false;

  /// The filter applied (what the editor starts from).
  Group get tree => _tree;

  /// The saved filter loaded, if any (it stays loaded while edited: Edited).
  Saved? get savedFilter => _savedFilter;

  /// Which list this is: it changes with the filter, the search or the order.
  int get generation => _generation;
  String get q => _q;
  bool get searched => _q.trim().isNotEmpty;
  bool get shuffled => _seed != null;
  int? get total => _total;
  String get error => _error;
  Aggregate? get aggregate => _aggregate;
  List<SavedFilter> get saved => _saved;
  Map<int, int> get savedCounts => _savedCounts;
  int? get allCount => _allCount;

  /// The saved filter's own query while it runs unchanged (it may hold parts the app can't show), else the tree's.
  Json? get filter {
    final saved = _savedFilter;
    if (saved != null &&
        saved.loaded.dropped > 0 &&
        _key(toWire(_tree)) == _key(toWire(saved.loaded.tree))) {
      return saved.loaded.wire;
    }
    return toWire(_tree);
  }

  /// Parts of the saved filter the app can't show, while they still apply.
  int get hidden {
    final saved = _savedFilter;
    return saved != null && _key(filter) == _key(saved.loaded.wire)
        ? saved.loaded.dropped
        : 0;
  }

  /// The filter's top-level conditions (a subgroup counts one) and its hidden parts, as the pill counts them.
  int get conditions => _tree.children.length + hidden;

  /// The saved filter loaded and then changed (its tree or its search).
  bool get edited {
    final saved = _savedFilter;
    return saved != null &&
        (_key(filter) != _key(saved.loaded.wire) ||
            _q.trim() != saved.loaded.q.trim());
  }

  /// Which sidebar row is on: all videos, a shortcut, a saved filter (by id), or none of them (another filter).
  ({bool all, Quick? quick, int? savedId}) get active {
    if (_savedFilter case final saved?)
      return (all: false, quick: null, savedId: saved.filter.id);
    if (searched) return (all: false, quick: null, savedId: null);
    if (_tree.children.isEmpty) return (all: true, quick: null, savedId: null);
    for (final quick in Quick.values) {
      if (quick.matches(_tree))
        return (all: false, quick: quick, savedId: null);
    }
    return (all: false, quick: null, savedId: null);
  }

  /// What the pill calls it: a saved filter's name, "Videos" for an unnamed filter or a search, "All videos".
  String get title {
    if (_savedFilter case final saved?) return saved.filter.name;
    return _tree.children.isEmpty && !searched ? 'All videos' : 'Videos';
  }

  /// Something filters (accent pill, Show all videos).
  bool get filtering =>
      _savedFilter != null || _tree.children.isNotEmpty || searched;

  /// What Save does for this tree: 'Save' (a changed saved filter the app can write whole), 'Save as…' (an unnamed
  /// filter or a search), or nothing to save (null).
  String? saveLabelFor(Group tree) {
    final saved = _savedFilter;
    if (saved != null) {
      final changed =
          _key(toWire(tree)) != _key(toWire(saved.loaded.tree)) ||
          _q.trim() != saved.loaded.q.trim();
      return changed && saved.loaded.dropped == 0 && tree.children.isNotEmpty
          ? 'Save'
          : null;
    }
    return tree.children.isNotEmpty || searched ? 'Save as…' : null;
  }

  /// "1,284 videos · 96 h · 945 GB"
  String get countLine {
    final total = _total, aggregate = _aggregate;
    if (total == null) return '';
    return [
      '${formatCount(total)} videos',
      if (aggregate != null) ...[
        '${formatCount((aggregate.duration / 3600).round())} h',
        formatSize(aggregate.fileSize),
      ],
    ].join(' · ');
  }

  /// At sign-in: the first page, the count line, the sidebar.
  void start() {
    _reload();
    _loadSidebar();
  }

  /// Applies a tree (the editor's, a chip added): a saved filter stays loaded (Edited) unless the tree is empty.
  void apply(Group tree) {
    if (_key(toWire(tree)) == _key(toWire(_tree)) &&
        tree.children.length == _tree.children.length) {
      _tree = tree;
      notifyListeners();
      return;
    }
    _tree = tree;
    if (tree.children.isEmpty) _savedFilter = null;
    _seed = null;
    _reload();
  }

  void showAll() {
    _tree = emptyTree();
    _savedFilter = null;
    _q = '';
    _seed = null;
    _reload();
  }

  void showQuick(Quick quick) {
    _tree = Group(id: newId(), op: GroupOp.all, children: [quick.condition()]);
    _savedFilter = null;
    _q = '';
    _seed = null;
    _reload();
  }

  /// A saved filter: its tree, its search (its view is the screen's), then the names of its tags and people.
  LoadedFilter showSaved(SavedFilter filter) {
    final loaded = loadSavedFilter(filter);
    _savedFilter = (filter: filter, loaded: loaded);
    _tree = loaded.tree;
    _q = loaded.q;
    _seed = null;
    _reload();
    _fillNames(loaded.tree);
    return loaded;
  }

  void search(String q) {
    if (q.trim() == _q.trim()) return;
    _q = q;
    _reload();
  }

  /// Shuffle on (a new seed: another order) or off (newest first).
  void shuffle() {
    _seed = _seed == null ? Random().nextInt(1 << 31) : null;
    _reload(aggregate: false);
  }

  /// A tag or a performer tapped on a card: into the filter, unless a top-level condition already has it.
  void addEntity(String fieldId, Named entity) {
    final has = _tree.children.any(
      (c) =>
          c is Condition &&
          c.field == fieldId &&
          (c.modifier == Modifier.includes ||
              c.modifier == Modifier.includesAll) &&
          c.ids.contains(entity.id),
    );
    if (has) return;
    apply(
      appendTo(
        _tree,
        _tree.id,
        Condition(
          id: newId(),
          field: fieldId,
          modifier: Modifier.includes,
          value: [entity.id],
          names: {entity.id: entity.name},
        ),
      ),
    );
  }

  /// Saves the tree into the loaded saved filter (with the search and the view), and runs it.
  Future<void> save(Group tree, {required bool list}) async {
    final saved = _savedFilter!;
    final updated = await client.updateSavedFilter(
      saved.filter.id,
      savedFilterChange(saved.filter, tree, list: list, q: _q),
    );
    _keepSaved(updated);
    _savedFilter = (filter: updated, loaded: loadSavedFilter(updated));
    apply(tree);
    notifyListeners();
  }

  /// Saves the tree as a new saved filter (Cove refuses a name taken: the error says so), and loads it.
  Future<void> saveAs(String name, Group tree, {required bool list}) async {
    final created = await client.createSavedFilter(
      newSavedFilter(name, tree, list: list, q: _q),
    );
    _keepSaved(created);
    _savedFilter = (filter: created, loaded: loadSavedFilter(created));
    apply(tree);
    notifyListeners();
    unawaited(_countSaved(created));
  }

  /// The first videos of the list as it is now (Play all): fetched, not the grid's pages.
  Future<List<Video>> firstVideos() async => (await client.findVideos(
    1,
    upNextCount + 1,
    filter: filter,
    seed: _seed,
    q: _q,
  )).items;

  /// The loaded videos after one, in the list's order (the player's Up next).
  List<Video> after(int id, [int n = upNextCount]) {
    final next = <Video>[];
    var found = false;
    for (final page in (_pages.keys.toList()..sort())) {
      for (final v in _pages[page]!) {
        if (found) {
          next.add(v);
          if (next.length >= n) return next;
        } else if (v.id == id) {
          found = true;
        }
      }
    }
    return next;
  }

  void _keepSaved(SavedFilter filter) {
    _saved = [
      for (final f in _saved)
        if (f.id != filter.id) f,
      filter,
    ]..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
  }

  Future<void> _countSaved(SavedFilter f) async {
    try {
      final n = await client.countMatching(filter: loadSavedFilter(f).wire);
      if (_disposed) return;
      _savedCounts[f.id] = n;
      notifyListeners();
    } catch (_) {}
  }

  /// The names of the tags, people, studios… a loaded tree names only by id.
  Future<void> _fillNames(Group tree) async {
    final missing = <(String, int)>{};
    void walk(Group g) {
      for (final c in g.children) {
        if (c is Group) {
          walk(c);
        } else if (c is Condition) {
          final lookup = fieldById(c.field).lookup;
          if (lookup == null) continue;
          for (final id in c.ids) {
            if (!c.names.containsKey(id)) missing.add((lookup.name, id));
          }
        }
      }
    }

    walk(tree);
    if (missing.isEmpty) return;
    final names = <(String, int), String>{};
    await Future.wait([
      for (final m in missing)
        client
            .entityName(m.$1, m.$2)
            .then((n) => names[m] = n, onError: (_) => names[m] = '#${m.$2}'),
    ]);
    if (_disposed) return;
    Group fill(Group g) => g.copyWith(
      children: [
        for (final c in g.children)
          if (c is Group)
            fill(c)
          else if (c is Condition && fieldById(c.field).lookup != null)
            c.copyWith(
              names: {
                ...c.names,
                for (final id in c.ids)
                  if (names[(fieldById(c.field).lookup!.name, id)]
                      case final n?)
                    id: n,
              },
            )
          else
            c,
      ],
    );
    // Only while that tree is still the one shown
    if (_tree.id == tree.id) _tree = fill(_tree);
    final saved = _savedFilter;
    if (saved != null && saved.loaded.tree.id == tree.id) {
      _savedFilter = (
        filter: saved.filter,
        loaded: LoadedFilter(
          tree: fill(saved.loaded.tree),
          dropped: saved.loaded.dropped,
          wire: saved.loaded.wire,
          list: saved.loaded.list,
          q: saved.loaded.q,
        ),
      );
    }
    notifyListeners();
  }

  /// Starts the list again from the server, and the sidebar with it (Refresh library).
  void refresh() {
    _reload();
    _loadSidebar();
  }

  /// The video at an index of the list: null while its page loads (asking for the page if no one has).
  Video? videoAt(int index) {
    final page = index ~/ perPage;
    final items = _pages[page];
    if (items == null) {
      _load(page);
      return null;
    }
    return index % perPage < items.length ? items[index % perPage] : null;
  }

  /// Asks again for the pages that failed.
  void retry() {
    _failed.clear();
    _error = '';
    if (_pages.isEmpty) _load(0);
    notifyListeners();
  }

  void _reload({bool aggregate = true}) {
    _generation++;
    _pages.clear();
    _loading.clear();
    _failed.clear();
    _error = '';
    _total = null;
    if (aggregate) _aggregate = null;
    notifyListeners();
    _load(0);
    if (aggregate) _loadAggregate();
  }

  Future<void> _load(int page) async {
    if (_loading.contains(page) || _failed.contains(page)) return;
    _loading.add(page);
    final generation = _generation;
    try {
      final result = await client.findVideos(
        page + 1,
        perPage,
        filter: filter,
        seed: _seed,
        q: _q,
      );
      if (_disposed || generation != _generation) return;
      _pages[page] = result.items;
      _total = result.totalCount;
      _error = '';
    } catch (e) {
      if (_disposed || generation != _generation) return;
      _failed.add(page);
      _error = e.toString();
    } finally {
      if (generation == _generation) _loading.remove(page);
    }
    notifyListeners();
  }

  Future<void> _loadAggregate() async {
    final generation = _generation;
    try {
      final aggregate = await client.aggregateVideos(filter: filter, q: _q);
      if (_disposed || generation != _generation) return;
      _aggregate = aggregate;
      notifyListeners();
    } catch (_) {}
  }

  Future<void> _loadSidebar() async {
    try {
      final saved = await client.savedFilters()
        ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
      if (_disposed) return;
      _saved = saved;
      notifyListeners();
    } catch (_) {}
    unawaited(
      client.countVideos().then((n) {
        if (_disposed) return;
        _allCount = n;
        notifyListeners();
      }, onError: (_) {}),
    );
    for (final f in _saved) {
      unawaited(_countSaved(f));
    }
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

/// The user's own data about a video, as a card shows it.
class Personal {
  const Personal({
    required this.favorite,
    required this.savedForLater,
    required this.rating,
    required this.playCount,
    required this.progress,
  });

  final bool favorite;
  final bool savedForLater;
  // 0–100
  final int? rating;
  final int playCount;
  // How far the user got: 0–1 (0: not started)
  final double progress;
}

/// The user's engagement (favorite, rating, plays, resume) and bookmarks, per video: asked for in batches (the cards
/// that ask in a frame go in one request), kept for the session, changed at once on a toggle.
class PersonalStore extends ChangeNotifier {
  PersonalStore(this.client);

  final CoveClient client;
  final _engagement = <int, Engagement>{};
  final _later = <int, bool>{};
  final _asked = <int>{};
  final _queue = <int>{};
  final _segments = <int, Future<List<Segment>>>{};
  Timer? _timer;
  bool _disposed = false;

  /// The user's data about a video: null until it is known (asking for it if no one has).
  Personal? of(Video video) {
    final id = video.id;
    if (_asked.add(id)) {
      _queue.add(id);
      _timer ??= Timer(Duration.zero, _flush);
    }
    final engagement = _engagement[id], later = _later[id];
    if (engagement == null || later == null) return null;
    final duration = video.primaryFile?.duration ?? 0;
    return Personal(
      favorite: engagement.isFavorite,
      savedForLater: later,
      rating: engagement.rating,
      playCount: engagement.playCount,
      progress: duration > 0 ? min(1, engagement.resumeTime / duration) : 0,
    );
  }

  /// Asks again for a video's data (it was just played: the resume position and play count moved).
  void refresh(int id) {
    _asked.add(id);
    _queue.add(id);
    _timer ??= Timer(Duration.zero, _flush);
  }

  /// The video's moments (Cove's segments), asked for once.
  Future<List<Segment>> segments(int id) =>
      _segments[id] ??= client.segments(id);

  /// Favorite on or off, at once (a failure puts it back).
  Future<void> toggleFavorite(Video video) async {
    final before = _engagement[video.id] ?? Engagement.none;
    _engagement[video.id] = before.copyWith(isFavorite: !before.isFavorite);
    notifyListeners();
    try {
      await client.setFavorite(video.id, !before.isFavorite);
    } catch (_) {
      if (_disposed) return;
      _engagement[video.id] = before;
      notifyListeners();
    }
  }

  /// Save for later on or off, at once (a failure puts it back).
  Future<void> toggleSavedForLater(Video video) async {
    final before = _later[video.id] ?? false;
    _later[video.id] = !before;
    notifyListeners();
    try {
      await client.setSavedForLater(video.id, !before);
    } catch (_) {
      if (_disposed) return;
      _later[video.id] = before;
      notifyListeners();
    }
  }

  /// Forgets everything (Refresh library): asked for again as cards show.
  void clear() {
    _engagement.clear();
    _later.clear();
    _asked.clear();
    _segments.clear();
    notifyListeners();
  }

  Future<void> _flush() async {
    _timer = null;
    final ids = _queue.toList();
    _queue.clear();
    for (var i = 0; i < ids.length; i += 100) {
      final chunk = ids.sublist(i, min(i + 100, ids.length));
      try {
        final (engagement, later) = await (
          client.engagement(chunk),
          client.savedForLater(chunk),
        ).wait;
        if (_disposed) return;
        for (final id in chunk) {
          _engagement[id] = engagement[id] ?? Engagement.none;
          _later[id] = later.contains(id);
        }
      } catch (_) {
        // Asked again when a card next shows it
        _asked.removeAll(chunk);
      }
    }
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    super.dispose();
  }
}
