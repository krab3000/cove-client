import 'dart:async';

import 'package:flutter/material.dart'
    show TextField, InputDecoration, InputBorder;
import 'package:flutter/widgets.dart';

import '../../../api/cove_client.dart';
import '../../../theme/tokens.dart';
import '../../../ui/button.dart';
import '../../../ui/icons.dart';
import '../../../ui/pressable.dart';
import '../../../utils/format.dart';
import '../model.dart';
import 'condition_editor.dart';

/// A folder picked: the folders from the library root down to it, and how many subfolders it has.
typedef FolderPick = ({List<FolderRef> chain, int subfolders});

Json _inFolder(String path) => {
  'operator': 'AND',
  'children': [
    {
      'filter': {
        'pathCriterion': {'value': path, 'modifier': 'underPath'},
      },
    },
  ],
};

/// Video counts per folder path, fetched once each.
class _Counts {
  _Counts(this.client, this.onChange);

  final CoveClient client;
  final VoidCallback onChange;
  final _cache = <String, int?>{};

  int? of(String path) {
    if (!_cache.containsKey(path)) {
      _cache[path] = null;
      client.countMatching(filter: _inFolder(path)).then((n) {
        _cache[path] = n;
        onChange();
      }, onError: (_) {});
    }
    return _cache[path];
  }
}

String _host(String server) => server
    .replaceFirst(RegExp(r'^[a-z]+://', caseSensitive: false), '')
    .replaceFirst(RegExp(r'[/:].*$'), '');

/// Design 3b: Cove's library folders, from the roots down. A folder with subfolders opens on a tap, one without is
/// selected; the footer picks the selection, else the folder being shown.
class FolderBrowser extends StatefulWidget {
  const FolderBrowser({
    super.key,
    required this.client,
    required this.start,
    required this.onPick,
    required this.onBack,
    required this.onType,
  });

  final CoveClient client;

  /// The folder to show first (the current pick), root first; empty: the library roots
  final List<FolderRef> start;
  final ValueChanged<FolderPick> onPick;
  final VoidCallback onBack;

  /// The typed path editor (3d); noAccess: this account may not list folders
  final ValueChanged<bool> onType;

  @override
  State<FolderBrowser> createState() => _FolderBrowserState();
}

class _FolderBrowserState extends State<FolderBrowser> {
  late List<FolderRef> _chain = [...widget.start];
  List<LibraryFolder>? _list;
  String _error = '';
  final _q = TextEditingController();
  String? _selected;
  late final _counts = _Counts(widget.client, () {
    if (mounted) setState(() {});
  });

  FolderRef? get _current => _chain.lastOrNull;

  @override
  void initState() {
    super.initState();
    _q.addListener(() => setState(() => _selected = null));
    _load();
  }

  @override
  void dispose() {
    _q.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final current = _current;
    setState(() {
      _list = null;
      _error = '';
    });
    try {
      final folders = await widget.client.libraryFolders(current?.path);
      if (mounted && current == _current) setState(() => _list = folders);
    } on CoveError catch (e) {
      if (!mounted) return;
      if (e.status == 403 && current == null) {
        widget.onType(true);
      } else {
        setState(() => _error = e.message);
      }
    }
  }

  void _go(List<FolderRef> chain) {
    _chain = chain;
    _selected = null;
    _q.clear();
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final needle = _q.text.trim().toLowerCase();
    final visible = [
      for (final f in _list ?? const <LibraryFolder>[])
        if (needle.isEmpty || f.name.toLowerCase().contains(needle)) f,
    ];
    final atRoot = _chain.isEmpty;
    final pick = visible.where((f) => f.path == _selected).firstOrNull;
    final FolderRef? target = pick != null
        ? FolderRef(pick.name, pick.path)
        : _current;
    final targetChain = pick != null
        ? [..._chain, FolderRef(pick.name, pick.path)]
        : _chain;
    final subfolders = pick != null ? 0 : (_list?.length ?? 0);
    final targetCount = target == null ? null : _counts.of(target.path);
    final crumbs = [const FolderRef('Library', ''), ..._chain];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        EditorHeader(
          title: 'Choose a folder',
          onBack: widget.onBack,
          trailing: Pressable(
            onPressed: () => widget.onType(false),
            semanticLabel: 'Type path',
            builder: (context, states) => Padding(
              padding: const EdgeInsets.all(8),
              child: Row(
                spacing: 6,
                children: [
                  const Icon(
                    Phosphor.cursorText,
                    size: 16,
                    color: Nocturne.accent300,
                  ),
                  Text(
                    'Type path',
                    style: inter(13.5, color: Nocturne.accent300),
                  ),
                ],
              ),
            ),
          ),
        ),
        SizedBox(
          height: 36,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            children: [
              for (final (i, c) in crumbs.indexed) ...[
                if (i > 0)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 2),
                    child: Icon(
                      Phosphor.caretRight,
                      size: 11,
                      color: Nocturne.textAlpha(45),
                    ),
                  ),
                Pressable(
                  onPressed: () => _go(_chain.sublist(0, i)),
                  semanticLabel: c.name,
                  builder: (context, states) => Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 6,
                      vertical: 8,
                    ),
                    child: Row(
                      spacing: 6,
                      children: [
                        if (i == 0)
                          Icon(
                            Phosphor.hardDrives,
                            size: 15,
                            color: i == crumbs.length - 1
                                ? Nocturne.accent300
                                : Nocturne.textAlpha(55),
                          ),
                        Text(
                          c.name,
                          style: inter(
                            13,
                            color: i == crumbs.length - 1
                                ? Nocturne.accent300
                                : Nocturne.textAlpha(65),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
          child: Container(
            height: 40,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(
              color: Nocturne.bg,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: Nocturne.divider),
            ),
            child: Row(
              spacing: 8,
              children: [
                Icon(
                  Phosphor.magnifyingGlass,
                  size: 16,
                  color: Nocturne.textAlpha(55),
                ),
                Expanded(
                  child: TextField(
                    controller: _q,
                    autocorrect: false,
                    cursorColor: Nocturne.accent,
                    style: inter(14.5, height: 18),
                    decoration: InputDecoration(
                      isDense: true,
                      border: InputBorder.none,
                      contentPadding: EdgeInsets.zero,
                      hintText: atRoot
                          ? 'Filter library folders'
                          : 'Filter folders in ${_current?.name}',
                      hintStyle: inter(
                        14.5,
                        height: 18,
                        color: Nocturne.textAlpha(40),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            children: [
              if (atRoot)
                Padding(
                  padding: const EdgeInsets.fromLTRB(4, 6, 4, 8),
                  child: Text(
                    'LIBRARY FOLDERS ON ${_host(widget.client.server).toUpperCase()}',
                    style: inter(
                      11.5,
                      color: Nocturne.textAlpha(50),
                      letterSpacing: 0.9,
                    ),
                  ),
                ),
              for (final folder in visible)
                _FolderRow(
                  folder: folder,
                  root: atRoot,
                  on: _selected == folder.path,
                  count: _counts.of(folder.path),
                  onPressed: () => folder.hasChildren
                      ? _go([..._chain, FolderRef(folder.name, folder.path)])
                      : setState(
                          () => _selected = _selected == folder.path
                              ? null
                              : folder.path,
                        ),
                ),
              if (_list != null && visible.isEmpty)
                _Empty(
                  needle.isNotEmpty
                      ? 'No folder here matches “${_q.text}”.'
                      : 'No folders inside this one.',
                ),
              if (_list == null && _error.isEmpty)
                const _Empty('Loading folders…'),
              if (_error.isNotEmpty) _Empty(_error),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.fromLTRB(20, 10, 20, 16),
          decoration: BoxDecoration(
            border: Border(top: BorderSide(color: Nocturne.divider)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            spacing: 10,
            children: [
              Row(
                spacing: 8,
                children: [
                  Icon(
                    Phosphor.treeStructure,
                    size: 14,
                    color: Nocturne.textAlpha(55),
                  ),
                  Expanded(
                    child: Text(
                      target != null
                          ? '${target.path}${subfolders > 0 ? ' · and its $subfolders subfolder${subfolders == 1 ? '' : 's'}' : ''}'
                          : 'Pick a library folder to start',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: inter(12, color: Nocturne.textAlpha(55)),
                    ),
                  ),
                ],
              ),
              CoveButton(
                label: target != null
                    ? 'Use “${target.name}”${targetCount == null ? '' : ' · ${formatCount(targetCount)} videos'}'
                    : 'Choose a folder',
                size: ButtonSize.lg,
                disabled: target == null,
                onPressed: () =>
                    widget.onPick((chain: targetChain, subfolders: subfolders)),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _FolderRow extends StatelessWidget {
  const _FolderRow({
    required this.folder,
    required this.root,
    required this.on,
    required this.count,
    required this.onPressed,
  });

  final LibraryFolder folder;
  final bool root;
  final bool on;
  final int? count;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final videos = count == null ? '… videos' : '${formatCount(count!)} videos';
    final icon = root ? Phosphor.hardDrives : Phosphor.folder;
    return Pressable(
      onPressed: onPressed,
      semanticLabel: folder.name,
      builder: (context, states) => Container(
        height: 64,
        padding: const EdgeInsets.symmetric(horizontal: 10),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(Nocturne.radiusMd),
          color: on
              ? Nocturne.accentAlpha(10)
              : states.highlighted || states.pressed
              ? Nocturne.textAlpha(5)
              : null,
          border: Border.all(
            color: on ? Nocturne.accent : Nocturne.accentAlpha(0),
          ),
        ),
        child: Row(
          spacing: 12,
          children: [
            Container(
              width: 40,
              height: 40,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: Nocturne.accentAlpha(14),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(
                on ? Phosphor.fill(icon) : icon,
                size: 20,
                color: Nocturne.accent,
              ),
            ),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                spacing: 2,
                children: [
                  Text(
                    folder.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: inter(
                      15,
                      weight: medium,
                      color: on ? Nocturne.accent200 : Nocturne.text,
                    ),
                  ),
                  Text(
                    root ? '${folder.path} · $videos' : videos,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: inter(12, color: Nocturne.textAlpha(55)),
                  ),
                ],
              ),
            ),
            if (folder.hasChildren)
              Icon(Phosphor.caretRight, size: 16, color: Nocturne.textAlpha(45))
            else
              Container(
                width: 20,
                height: 20,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: on ? Nocturne.accent : Nocturne.textAlpha(35),
                    width: 1.5,
                  ),
                ),
                child: on
                    ? Container(
                        width: 10,
                        height: 10,
                        decoration: const BoxDecoration(
                          shape: BoxShape.circle,
                          color: Nocturne.accent,
                        ),
                      )
                    : null,
              ),
          ],
        ),
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 6),
    child: Text(text, style: inter(13, color: Nocturne.textAlpha(55))),
  );
}

/// Design 3d: a path typed in, for accounts that can't browse folders (then a banner says so) and for anyone who'd
/// rather type. Suggests the folders under the typed parent and says whether the folder exists.
class TypedPath extends StatefulWidget {
  const TypedPath({
    super.key,
    required this.client,
    required this.noAccess,
    required this.initial,
    required this.onPick,
    required this.onBack,
  });

  final CoveClient client;
  final bool noAccess;
  final String initial;
  final ValueChanged<FolderPick> onPick;
  final VoidCallback onBack;

  @override
  State<TypedPath> createState() => _TypedPathState();
}

class _TypedPathState extends State<TypedPath> {
  late final _text = TextEditingController(text: widget.initial);
  late bool _noAccess = widget.noAccess;
  List<LibraryFolder> _roots = const [];
  List<LibraryFolder> _siblings = const [];
  List<LibraryFolder> _children = const [];
  int? _count;
  Timer? _timer;
  Timer? _countTimer;
  String _countedFor = '';

  @override
  void initState() {
    super.initState();
    _text.addListener(_changed);
    if (!_noAccess) {
      widget.client.libraryFolders().then(
        (roots) {
          if (mounted) setState(() => _roots = roots);
          _changed();
        },
        onError: (Object e) {
          if (mounted && e is CoveError && e.status == 403)
            setState(() => _noAccess = true);
        },
      );
    }
    _changed();
  }

  @override
  void dispose() {
    _timer?.cancel();
    _countTimer?.cancel();
    _text.dispose();
    super.dispose();
  }

  String get _trimmed => _text.text.trim();
  String get _normalized => _trimmed.replaceFirst(RegExp(r'[\\/]+$'), '');
  int _cut(String s) => s.lastIndexOf('/') > s.lastIndexOf('\\')
      ? s.lastIndexOf('/')
      : s.lastIndexOf('\\');
  String get _parent =>
      _cut(_trimmed) > 0 ? _trimmed.substring(0, _cut(_trimmed)) : '';
  String get _normalizedParent =>
      _cut(_normalized) > 0 ? _normalized.substring(0, _cut(_normalized)) : '';

  bool _inside(String p) => _roots.any((r) {
    final base = r.path.replaceFirst(RegExp(r'[\\/]+$'), '').toLowerCase();
    final low = p.toLowerCase();
    return low == base || low.startsWith('$base/') || low.startsWith('$base\\');
  });

  void _changed() {
    setState(() {});
    _timer?.cancel();
    _timer = Timer(const Duration(milliseconds: 250), () async {
      if (_noAccess) return _recount();
      Future<List<LibraryFolder>> list(String p) async {
        if (p.isEmpty || !_inside(p)) return const [];
        try {
          return await widget.client.libraryFolders(p);
        } catch (_) {
          return const [];
        }
      }

      final (children, siblings) = await (
        list(_parent),
        list(_normalizedParent),
      ).wait;
      if (!mounted) return;
      setState(() {
        _children = children;
        _siblings = siblings;
      });
      _recount();
    });
  }

  LibraryFolder? get _exact {
    final low = _normalized.toLowerCase();
    for (final r in _roots) {
      if (r.path.replaceFirst(RegExp(r'[\\/]+$'), '').toLowerCase() == low)
        return r;
    }
    for (final f in _siblings) {
      if (f.path.toLowerCase() == low) return f;
    }
    return null;
  }

  void _recount() {
    final path = _noAccess
        ? (_normalized.isEmpty ? null : _normalized)
        : _exact?.path;
    if (path == _countedFor) return;
    _countedFor = path ?? '';
    _countTimer?.cancel();
    setState(() => _count = null);
    if (path == null) return;
    _countTimer = Timer(const Duration(milliseconds: 250), () async {
      try {
        final n = await widget.client.countMatching(filter: _inFolder(path));
        if (mounted && _countedFor == path) setState(() => _count = n);
      } catch (_) {}
    });
  }

  @override
  Widget build(BuildContext context) {
    final trimmed = _trimmed;
    final cut = _cut(trimmed);
    final partial = trimmed.substring(cut + 1).toLowerCase();
    final exact = _exact;
    final suggestions = _noAccess
        ? const <LibraryFolder>[]
        : [
            for (final f in cut > 0 ? _children : _roots)
              if (f.name.toLowerCase().startsWith(partial) &&
                  f.path.toLowerCase() != _normalized.toLowerCase())
                f,
          ];
    String status;
    bool? ok;
    final videos = _count == null ? '' : ' · ${formatCount(_count!)} videos';
    if (_noAccess) {
      ok = trimmed.isNotEmpty ? true : null;
      status = trimmed.isNotEmpty
          ? 'Cove matches this path as typed$videos'
          : 'Type the full path of a folder in the library.';
    } else if (trimmed.isEmpty) {
      status = _roots.isNotEmpty
          ? 'Library folders: ${_roots.map((r) => r.path).join(', ')}'
          : 'Type the full path of a folder in the library.';
    } else if (exact != null) {
      ok = true;
      status = 'Folder found$videos, its subfolders included';
    } else if (_inside(trimmed)) {
      ok = false;
      status = 'Inside a library folder; no folder by that name yet';
    } else {
      ok = false;
      status = 'Not inside a library folder: nothing would match';
    }
    final roots = [for (final r in _roots) FolderRef(r.name, r.path)];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        EditorHeader(title: 'Type a folder path', onBack: widget.onBack),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
            children: [
              if (_noAccess)
                Container(
                  margin: const EdgeInsets.only(top: 8),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Nocturne.accentAlpha(9),
                    borderRadius: BorderRadius.circular(Nocturne.radiusMd),
                    border: Border.all(color: Nocturne.accentAlpha(30)),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    spacing: 10,
                    children: [
                      const Icon(
                        Phosphor.lockSimple,
                        size: 16,
                        color: Nocturne.accent300,
                      ),
                      Expanded(
                        child: Text(
                          'This account can’t browse folders (that needs the Files or Library scan permission). '
                          'Type a path inside a library folder; Cove still checks it.',
                          style: inter(
                            12.5,
                            color: Nocturne.textAlpha(75),
                            height: 18,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              const SectionLabel('Folder path'),
              ValueField(
                initial: '',
                controller: _text,
                mono: true,
                autofocus: true,
                placeholder: _roots.isNotEmpty
                    ? '${_roots.first.path}/…'
                    : '/path/to/folder',
                onChanged: (_) {},
              ),
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: 8,
                  children: [
                    Icon(
                      ok == true
                          ? Phosphor.fill(Phosphor.checkCircle)
                          : ok == false
                          ? Phosphor.warningCircle
                          : Phosphor.hardDrives,
                      size: 14,
                      color: ok == true
                          ? Nocturne.accent300
                          : Nocturne.textAlpha(55),
                    ),
                    Expanded(
                      child: Text(
                        status,
                        style: inter(
                          12.5,
                          color: ok == true
                              ? Nocturne.accent300
                              : Nocturne.textAlpha(60),
                          height: 18,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              if (suggestions.isNotEmpty)
                const SectionLabel('Folders here', top: 18),
              for (final f in suggestions)
                Pressable(
                  onPressed: () {
                    final sep = f.path.contains('\\') && !f.path.contains('/')
                        ? '\\'
                        : '/';
                    _text.text = f.path + (f.hasChildren ? sep : '');
                    _text.selection = TextSelection.collapsed(
                      offset: _text.text.length,
                    );
                  },
                  semanticLabel: f.name,
                  builder: (context, states) => Container(
                    height: 44,
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(Nocturne.radiusMd),
                      color: states.highlighted || states.pressed
                          ? Nocturne.textAlpha(6)
                          : null,
                    ),
                    child: Row(
                      spacing: 10,
                      children: [
                        const Icon(
                          Phosphor.folder,
                          size: 18,
                          color: Nocturne.accent,
                        ),
                        Expanded(
                          child: Text.rich(
                            TextSpan(
                              children: [
                                TextSpan(
                                  text: f.name.substring(
                                    0,
                                    partial.length.clamp(0, f.name.length),
                                  ),
                                  style: const TextStyle(
                                    color: Nocturne.accent300,
                                  ),
                                ),
                                TextSpan(
                                  text: f.name.substring(
                                    partial.length.clamp(0, f.name.length),
                                  ),
                                ),
                              ],
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: inter(14.5),
                          ),
                        ),
                        Icon(
                          Phosphor.arrowElbowDownRight,
                          size: 14,
                          color: Nocturne.textAlpha(45),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
          decoration: BoxDecoration(
            border: Border(top: BorderSide(color: Nocturne.divider)),
          ),
          child: CoveButton(
            label: 'Use this folder',
            size: ButtonSize.lg,
            disabled: ok != true,
            onPressed: () {
              final path = exact?.path ?? _normalized;
              widget.onPick((
                chain: folderChain(path, roots),
                subfolders: exact != null && _parent == _normalized
                    ? _children.length
                    : 0,
              ));
            },
          ),
        ),
      ],
    );
  }
}
