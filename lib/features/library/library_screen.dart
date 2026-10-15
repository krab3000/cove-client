import 'dart:async';

import 'package:flutter/material.dart' show ScaffoldMessenger, SnackBar;
import 'package:flutter/widgets.dart';

import '../../api/cove_client.dart';
import '../../app/back.dart';
import '../../data/library.dart';
import '../../features/filter/model.dart';
import '../../state/player.dart';
import '../../state/prefs.dart';
import '../../state/session.dart';
import '../../state/settings_nav.dart';
import '../../theme/layout.dart';
import '../../theme/tokens.dart';
import '../../ui/button.dart';
import '../../ui/drawer.dart';
import '../../ui/icons.dart';
import '../../ui/misc.dart';
import '../../ui/popover.dart';
import '../../ui/sheet.dart';
import '../../ui/text_field.dart';
import '../../utils/format.dart';
import '../filter/filter_screen.dart';
import '../player/player_screen.dart';
import 'components/library_grid.dart';
import 'components/library_header.dart';
import 'components/library_sidebar.dart';
import 'components/video_detail.dart';

// The search applies once typing pauses this long
const _searchDelay = Duration(milliseconds: 400);
// The filter drawer's edits apply once they pause this long (the Library behind follows them)
const _dockedApply = Duration(milliseconds: 500);
const _sidebarWidth = 232.0;
const _drawerWidth = 360.0;
const _filterWidth = 420.0;

/// The Library (design turn 8): a tablet's sidebar beside it (8f) with the preview drawer (1h) and the filter drawer
/// (2d); a phone's header with the Show sheet (8d) and the account sheet (6e), the filter editor full screen (2b); one
/// header row held sideways (6f). Tapping a video plays it (on a tablet: opens the preview, tapped again plays it). The
/// player (1k–1m) comes over the Library, which keeps its place under it.
class LibraryScreen extends StatefulWidget {
  const LibraryScreen({super.key, required this.client});

  final CoveClient client;

  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends State<LibraryScreen> {
  late final _library = Library(widget.client)..start();
  late final _personal = PersonalStore(widget.client);
  final _search = TextEditingController();
  Timer? _searchTimer;
  bool _quietSearch = false;

  // The video in the preview drawer: open while there is one; kept while the drawer slides out
  Video? _picked;
  bool _drawerOpen = false;

  // The filter editor: open, and the tree it edits (the applied one when it opened)
  bool _filterOpen = false;
  Group _filterTree = emptyTree();
  Timer? _applyTimer;

  @override
  void initState() {
    super.initState();
    _search.addListener(_onSearch);
  }

  @override
  void dispose() {
    _searchTimer?.cancel();
    _applyTimer?.cancel();
    _search.dispose();
    _library.dispose();
    _personal.dispose();
    super.dispose();
  }

  bool get _large => screenClassOf(context) == ScreenClass.large;

  void _onSearch() {
    if (_quietSearch) return;
    _searchTimer?.cancel();
    _searchTimer = Timer(_searchDelay, () => _library.search(_search.text));
  }

  /// The search box shows a search applied from elsewhere (a saved filter's, Show all) without searching again.
  void _setSearchText(String q) {
    _searchTimer?.cancel();
    _quietSearch = true;
    _search.text = q;
    _quietSearch = false;
  }

  // --- What is shown ---------------------------------------------------------------------------------------------

  void _showAll() {
    _setSearchText('');
    _library.showAll();
    _closeFilter();
  }

  void _showQuick(Quick quick) {
    _setSearchText('');
    _library.showQuick(quick);
    _closeFilter();
  }

  /// A saved filter brings its search and its view.
  void _showSaved(SavedFilter filter) {
    final loaded = _library.showSaved(filter);
    _setSearchText(loaded.q);
    if (loaded.list == true) prefs.libraryView = LibraryView.list;
    if (loaded.list == false && prefs.libraryView == LibraryView.list)
      prefs.libraryView = LibraryView.grid3;
    if (_filterOpen) setState(() => _filterTree = loaded.tree);
  }

  void _addTag(Named tag) => _library.addEntity('tags', tag);

  void _addPerformer(Named performer) =>
      _library.addEntity('performers', performer);

  // --- Playing ---------------------------------------------------------------------------------------------------

  void _play(Video video, {double? startAt}) {
    player.play(video, _library.after(video.id), startAt: startAt);
  }

  /// Play all: the list as it is now, from its first video.
  Future<void> _playAll() async {
    try {
      final videos = await _library.firstVideos();
      if (videos.isNotEmpty) player.play(videos.first, videos.sublist(1));
    } catch (e) {
      _toast(e.toString());
    }
  }

  /// A tablet: the preview drawer on that video (or switched to it); the one shown again plays. A phone: plays.
  void _press(Video video) {
    if (!_large) return _play(video);
    if (_drawerOpen && _picked?.id == video.id) return _play(video);
    setState(() {
      _picked = video;
      _drawerOpen = true;
      _filterOpen = false;
    });
  }

  void _closeDrawer() {
    if (_drawerOpen) setState(() => _drawerOpen = false);
  }

  // --- The filter ------------------------------------------------------------------------------------------------

  void _openFilter() => setState(() {
    _filterTree = _library.tree;
    _filterOpen = true;
    _drawerOpen = false;
  });

  void _closeFilter() {
    _applyTimer?.cancel();
    if (_filterOpen) {
      // Docked edits still pending apply now
      if (_large) _library.apply(_filterTree);
      setState(() => _filterOpen = false);
    }
  }

  void _onFilterChange(Group tree) {
    setState(() => _filterTree = tree);
    if (!_large) return;
    _applyTimer?.cancel();
    _applyTimer = Timer(_dockedApply, () => _library.apply(_filterTree));
  }

  Group get _savingTree => _filterOpen ? _filterTree : _library.tree;
  bool get _listView => prefs.libraryView == LibraryView.list;

  Future<void> _save() async {
    if (_library.savedFilter == null) return _saveAs();
    try {
      await _library.save(_savingTree, list: _listView);
      _toast('Saved “${_library.savedFilter!.filter.name}”');
    } catch (e) {
      _toast(e.toString());
    }
  }

  /// Save as a new filter: a dialog on a tablet, a sheet on a phone.
  void _saveAs() {
    final tree = _savingTree;
    Widget form(BuildContext inner) => _SaveAsForm(
      onSave: (name) async {
        await _library.saveAs(name, tree, list: _listView);
        if (inner.mounted) Navigator.of(inner).pop();
      },
    );
    if (_large) {
      showCoveDialog<void>(
        context,
        title: 'Save as a new filter',
        builder: form,
      );
    } else {
      showSheet<void>(
        context,
        builder: (sheet) => Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [const SheetHeading('Save as a new filter'), form(sheet)],
        ),
      );
    }
  }

  bool get _canSaveNew =>
      _library.savedFilter == null &&
      (_library.tree.children.isNotEmpty || _library.searched);

  // --- Menus and sheets ------------------------------------------------------------------------------------------

  /// The pill: a tablet's menu under it (8g) — the drawer closes when it is open —; a phone's Show sheet (8d).
  void _pill(Rect anchor) {
    if (!_large) return _showSheet();
    if (_filterOpen) return _closeFilter();
    final conditions = _library.conditions;
    showPopover(
      context,
      anchor: anchor,
      alignLeft: true,
      width: 320,
      entries: [
        MenuEntry(
          icon: Phosphor.funnelSimple,
          label: 'Edit conditions…',
          detail: conditions > 0
              ? '$conditions condition${conditions == 1 ? '' : 's'} · the filter drawer'
              : 'Build a filter: the filter drawer',
          onPressed: _openFilter,
        ),
        if (_canSaveNew)
          MenuEntry(
            icon: Phosphor.plus,
            label: 'Save as new filter…',
            detail: 'The filter, search, sort and view',
            onPressed: _saveAs,
          ),
        if (_library.filtering) ...[
          const Rule(),
          MenuEntry(
            icon: Phosphor.xCircle,
            label: 'Show all videos',
            onPressed: _showAll,
          ),
        ],
      ],
    );
  }

  void _showSheet() {
    final active = _library.active;
    String videos(int? n) => n == null ? '…' : '${formatCount(n)} videos';
    final conditions = _library.conditions;
    showSheet<void>(
      context,
      builder: (sheet) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SheetHeading('Show'),
          Flexible(
            child: MenuList(
              onClose: () => Navigator.of(sheet).pop(),
              entries: [
                MenuEntry(
                  icon: Phosphor.filmStrip,
                  label: 'All videos',
                  meta: videos(_library.allCount),
                  selected: active.all,
                  onPressed: _showAll,
                ),
                if (_library.saved.isNotEmpty) const _Section('Saved filters'),
                for (final f in _library.saved)
                  MenuEntry(
                    icon: Phosphor.bookmarksSimple,
                    label: f.name,
                    meta: videos(_library.savedCounts[f.id]),
                    selected: active.savedId == f.id,
                    onPressed: () => _showSaved(f),
                  ),
                const _Section('Quick'),
                for (final q in Quick.values)
                  MenuEntry(
                    icon: q.icon,
                    label: q.sheetLabel,
                    selected: active.quick == q,
                    onPressed: () => _showQuick(q),
                  ),
                const Rule(),
                MenuEntry(
                  icon: Phosphor.funnelSimple,
                  label: 'Edit conditions…',
                  detail: conditions > 0
                      ? '$conditions condition${conditions == 1 ? '' : 's'} · the rule tree'
                      : 'Build a filter: the rule tree',
                  onPressed: _openFilter,
                ),
                if (_canSaveNew)
                  MenuEntry(
                    icon: Phosphor.plus,
                    label: 'Save as new filter…',
                    onPressed: _saveAs,
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// The account: a tablet's menu over its row; a phone's sheet (6e).
  void _account([Rect? anchor]) {
    final entries = <Object>[
      MenuEntry(
        icon: Phosphor.arrowClockwise,
        label: 'Refresh library',
        onPressed: () {
          _personal.clear();
          _library.refresh();
        },
      ),
      MenuEntry(
        icon: Phosphor.gearSix,
        label: 'Settings',
        meta: 'This device',
        onPressed: () => settingsNav.open(SettingsFrom.library),
      ),
      MenuEntry(
        icon: Phosphor.signOut,
        label: 'Log out',
        onPressed: session.logout,
      ),
    ];
    if (anchor != null) {
      showPopover(
        context,
        anchor: anchor,
        above: true,
        alignLeft: true,
        width: _sidebarWidth - 24,
        entries: entries,
      );
      return;
    }
    showSheet<void>(
      context,
      builder: (sheet) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
            child: Row(
              spacing: 14,
              children: [
                Avatar(widget.client.username, size: 48),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    spacing: 4,
                    children: [
                      Text(
                        widget.client.username,
                        style: inter(17, weight: medium),
                      ),
                      ServerPill(
                        name: widget.client.server.replaceFirst(
                          RegExp(r'^https?://'),
                          '',
                        ),
                        online: true,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 8),
            child: Rule(),
          ),
          Flexible(
            child: MenuList(
              entries: entries,
              onClose: () => Navigator.of(sheet).pop(),
            ),
          ),
        ],
      ),
    );
  }

  void _toast(String text) => ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));

  // --- Layout ----------------------------------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final screen = screenClassOf(context);
    final large = screen == ScreenClass.large;
    return ListenableBuilder(
      listenable: Listenable.merge([_library, prefs, player]),
      builder: (context, _) {
        final playing = player.playing;
        final content = ColoredBox(
          color: Nocturne.bg,
          child: large
              ? _tablet(playing == null)
              : _phone(screen, playing == null),
        );
        return Stack(
          children: [
            // Under the player the Library stays as it was (its place in the list, its drawers)
            Offstage(
              offstage: playing != null,
              child: TickerMode(enabled: playing == null, child: content),
            ),
            if (playing != null)
              Positioned.fill(
                child: PlayerScreen(
                  key: ValueKey(playing.video.id),
                  client: widget.client,
                  personal: _personal,
                  video: playing.video,
                  upNext: playing.upNext,
                  startAt: playing.startAt,
                  crumb: _library.savedFilter == null
                      ? 'Library'
                      : 'Library › ${_library.savedFilter!.filter.name}',
                  onPlayNext: (video, upNext) => player.play(video, upNext),
                  onClose: player.close,
                ),
              ),
          ],
        );
      },
    );
  }

  Widget _tablet(bool previews) {
    final saveLabel = _library.saveLabelFor(_savingTree);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          width: _sidebarWidth,
          child: Padding(
            padding: EdgeInsets.only(top: MediaQuery.paddingOf(context).top),
            child: LibrarySidebar(
              library: _library,
              username: widget.client.username,
              onAll: _showAll,
              onQuick: _showQuick,
              onSaved: _showSaved,
              onSaveNew: _saveAs,
              onAccount: _account,
              onSettings: () => settingsNav.open(SettingsFrom.library),
            ),
          ),
        ),
        Expanded(
          child: Padding(
            padding: EdgeInsets.only(top: MediaQuery.paddingOf(context).top),
            child: Stack(
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    LibraryHeader(
                      library: _library,
                      search: _search,
                      view: prefs.libraryView,
                      onView: (view) => prefs.libraryView = view,
                      onPill: _pill,
                      onPlayAll: _playAll,
                      layout: HeaderLayout.large,
                      username: widget.client.username,
                      onAccount: _account,
                      filterOpen: _filterOpen,
                    ),
                    Expanded(child: _grid(previews: previews && !_filterOpen)),
                  ],
                ),
                BackHandler(
                  layer: Layer.drawer,
                  enabled: _drawerOpen,
                  onBack: _closeDrawer,
                  child: CoveDrawer(
                    open: _drawerOpen,
                    onClose: _closeDrawer,
                    width: _drawerWidth,
                    child: _picked == null
                        ? const SizedBox.shrink()
                        : VideoDetail(
                            client: widget.client,
                            personal: _personal,
                            video: _picked!,
                            onPlay: _play,
                            onClose: _closeDrawer,
                            onAddTag: _addTag,
                            onAddPerformer: _addPerformer,
                          ),
                  ),
                ),
                CoveDrawer(
                  open: _filterOpen,
                  onClose: _closeFilter,
                  width: _filterWidth,
                  child: _filterOpen
                      ? FilterScreen(
                          docked: true,
                          client: widget.client,
                          tree: _filterTree,
                          onChange: _onFilterChange,
                          onClose: _closeFilter,
                          title: _library.savedFilter?.filter.name,
                          savedEdited: _library.edited,
                          saveLabel: saveLabel,
                          onSave: _save,
                        )
                      : const SizedBox.shrink(),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _phone(ScreenClass screen, bool previews) {
    final sideways = screen == ScreenClass.sideways;
    final padding = MediaQuery.paddingOf(context);
    return Stack(
      children: [
        Padding(
          padding: EdgeInsets.only(
            top: padding.top,
            left: padding.left,
            right: padding.right,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              LibraryHeader(
                library: _library,
                search: _search,
                view: prefs.libraryView,
                onView: (view) => prefs.libraryView = view,
                onPill: _pill,
                onPlayAll: _playAll,
                layout: sideways ? HeaderLayout.sideways : HeaderLayout.phone,
                username: widget.client.username,
                onAccount: _account,
              ),
              Expanded(
                child: _grid(
                  previews: previews && !_filterOpen,
                  sideways: sideways,
                ),
              ),
            ],
          ),
        ),
        if (_filterOpen)
          Positioned.fill(
            child: FilterScreen(
              client: widget.client,
              tree: _filterTree,
              onChange: _onFilterChange,
              onClose: () => setState(() => _filterOpen = false),
              title: _library.savedFilter?.filter.name,
              savedEdited: _library.edited,
              saveLabel: _library.saveLabelFor(_filterTree),
              onSave: _save,
              onApply: (tree) {
                _library.apply(tree);
                setState(() => _filterOpen = false);
              },
              onPlayAll: (tree) {
                _library.apply(tree);
                setState(() => _filterOpen = false);
                _playAll();
              },
            ),
          ),
      ],
    );
  }

  Widget _grid({required bool previews, bool sideways = false}) => LibraryGrid(
    library: _library,
    personal: _personal,
    view: prefs.libraryView,
    selectedId: _drawerOpen ? _picked?.id : null,
    onPressed: _press,
    onBackground: () {
      _closeDrawer();
      if (_filterOpen && _large) _closeFilter();
    },
    previews: previews && prefs.previews,
    onAddTag: _addTag,
    onAddPerformer: _addPerformer,
    sideways: sideways,
  );
}

/// A section's label inside a menu list.
class _Section extends StatelessWidget {
  const _Section(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(12, 14, 12, 6),
    child: Text(
      text.toUpperCase(),
      style: inter(11.5, color: Nocturne.textAlpha(50), letterSpacing: 0.9),
    ),
  );
}

/// Save as a new filter: its name (Cove refuses one taken: the error says so).
class _SaveAsForm extends StatefulWidget {
  const _SaveAsForm({required this.onSave});

  final Future<void> Function(String name) onSave;

  @override
  State<_SaveAsForm> createState() => _SaveAsFormState();
}

class _SaveAsFormState extends State<_SaveAsForm> {
  final _name = TextEditingController();
  String _error = '';
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _name.addListener(() {
      if (_error.isNotEmpty) setState(() => _error = '');
    });
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty || _busy) return;
    setState(() => _busy = true);
    try {
      await widget.onSave(_name.text.trim());
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: 12,
      children: [
        Text(
          'The filter, the search and the view, as a saved filter in Cove.',
          style: inter(13, color: Nocturne.textAlpha(60), height: 19),
        ),
        CoveTextField(
          controller: _name,
          placeholder: 'Name',
          autofocus: true,
          onSubmitted: (_) => _save(),
        ),
        if (_error.isNotEmpty) ErrorText(_error),
        ValueListenableBuilder(
          valueListenable: _name,
          builder: (context, value, _) => CoveButton(
            label: 'Save',
            size: ButtonSize.lg,
            busy: _busy,
            disabled: value.text.trim().isEmpty,
            onPressed: _save,
          ),
        ),
      ],
    ),
  );
}
