import 'dart:async';
import 'dart:convert';

import 'package:flutter/widgets.dart';

import '../../api/cove_client.dart';
import '../../app/back.dart';
import '../../theme/tokens.dart';
import '../../ui/button.dart';
import '../../ui/icon_button.dart';
import '../../ui/icons.dart';
import '../../ui/pressable.dart';
import '../../ui/sheet.dart';
import '../../utils/format.dart';
import 'actions.dart';
import 'components/condition_editor.dart';
import 'components/rule_rows.dart';
import 'model.dart';

/// The filter editor (design 2b; on a tablet the drawer 2d with its sheets and pages inside it, 9a–9d): the rule tree
/// as an outline — a plain-words summary, the operator pill, conditions as rows, subgroups one level down, deeper
/// groups as rows that open (5a–5d) — edited with ⋮ menus (cut / copy / paste, wrap, ungroup, simplify; 4a–4c) and
/// "+ Add" (5e). Docked, the Library behind follows the tree; on a phone Show applies it.
class FilterScreen extends StatefulWidget {
  const FilterScreen({
    super.key,
    required this.client,
    required this.tree,
    required this.onChange,
    required this.onClose,
    this.docked = false,
    this.title,
    this.savedEdited = false,
    this.saveLabel,
    this.onSave,
    this.onApply,
    this.onPlayAll,
  });

  final CoveClient client;
  final Group tree;
  final ValueChanged<Group> onChange;
  final VoidCallback onClose;

  /// In the tablet's drawer
  final bool docked;

  /// The saved filter's name, if one is loaded
  final String? title;
  final bool savedEdited;
  final String? saveLabel;
  final VoidCallback? onSave;

  /// A phone: Show N videos (applies the tree) and Play all
  final ValueChanged<Group>? onApply;
  final ValueChanged<Group>? onPlayAll;

  @override
  State<FilterScreen> createState() => _FilterScreenState();
}

class _FilterScreenState extends State<FilterScreen> {
  Group get _tree => widget.tree;

  ({String groupId, Condition? condition})? _editing;
  Node? _menu;
  // Design 5e: what "+ Add" adds to
  Group? _adding;
  // Design 4b: a cut item stays in place (dimmed) until a paste moves it; a copy pastes as new copies.
  Clipboard? _clipboard;
  // Design 5c: the groups opened on the way here, in order; the last one still in the tree is open.
  List<String> _opened = [];
  bool _summaryOpen = false;
  bool _levels = false;
  String? _cameFrom;
  Timer? _cameFromTimer;
  // A level slides in from the side it comes from
  int _direction = 0;
  final _scroll = ScrollController();
  final _offsets = <String, double>{};

  int? _count;
  String _counted = '';
  Timer? _countTimer;

  @override
  void initState() {
    super.initState();
    _recount();
  }

  @override
  void didUpdateWidget(FilterScreen old) {
    super.didUpdateWidget(old);
    _recount();
    // A cut item that is gone from the tree (removed, merged by Simplify) can't be pasted any more.
    final cut = _clipboard;
    if (cut != null && cut.cut && findNode(_tree, cut.node.id) == null)
      _clipboard = null;
  }

  @override
  void dispose() {
    _countTimer?.cancel();
    _cameFromTimer?.cancel();
    _scroll.dispose();
    super.dispose();
  }

  /// The live count, once the tree has settled for a moment.
  void _recount() {
    final wire = jsonEncode(toWire(_tree));
    if (wire == _counted) return;
    _counted = wire;
    _countTimer?.cancel();
    _countTimer = Timer(const Duration(milliseconds: 300), () async {
      try {
        final n = await widget.client.countMatching(filter: toWire(_tree));
        if (mounted && _counted == wire) setState(() => _count = n);
      } catch (_) {}
    });
  }

  List<Group> get _chain {
    for (var i = _opened.length - 1; i >= 0; i--) {
      final found = findChain(_tree, _opened[i]);
      if (found != null) return found;
    }
    return [_tree];
  }

  Group get _focus => _chain.last;
  bool get _atRoot => _chain.length == 1;

  /// The levels back and the breadcrumb go to: the root and the groups opened (a level skipped is only named).
  Set<String> get _visited => {
    _tree.id,
    for (final id in _opened)
      if (_chain.any((g) => g.id == id)) id,
  };

  void _goTo(Group target, {required bool deeper}) {
    final next = findChain(_tree, target.id);
    if (next == null) return;
    final chain = _chain, visited = _visited;
    setState(() {
      _offsets[_focus.id] = _scroll.hasClients ? _scroll.offset : 0;
      _direction = deeper ? 1 : -1;
      // Back up: ring the level opened from there
      if (!deeper) {
        _cameFrom = chain
            .skip(next.length)
            .where((g) => visited.contains(g.id))
            .firstOrNull
            ?.id;
        _cameFromTimer?.cancel();
        _cameFromTimer = Timer(const Duration(milliseconds: 1400), () {
          if (mounted) setState(() => _cameFrom = null);
        });
      }
      _opened = [
        for (final id in _opened)
          if (id != target.id && next.any((g) => g.id == id)) id,
        if (target.id != _tree.id) target.id,
      ];
      _summaryOpen = false;
      _levels = false;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients)
        _scroll.jumpTo(
          (_offsets[_focus.id] ?? 0).clamp(0, _scroll.position.maxScrollExtent),
        );
    });
  }

  void _open(Group group) => _goTo(group, deeper: true);

  void _up() {
    final visited = _visited;
    _goTo(
      _chain
              .sublist(0, _chain.length - 1)
              .reversed
              .where((g) => visited.contains(g.id))
              .firstOrNull ??
          _tree,
      deeper: false,
    );
  }

  void _change(Group tree) => widget.onChange(tree);

  void _cycle(Group group) => _change(
    replaceNode(_tree, group.id, group.copyWith(op: nextOp(group.op))),
  );

  void _pasteInto(String groupId) {
    final clipboard = _clipboard;
    if (clipboard == null) return;
    _change(paste(_tree, clipboard, PasteInto(groupId)));
    if (clipboard.cut) setState(() => _clipboard = null);
  }

  void _pasteBeside(String id, {required bool before}) {
    final clipboard = _clipboard;
    if (clipboard == null) return;
    _change(paste(_tree, clipboard, PasteAt(id, before: before)));
    if (clipboard.cut) setState(() => _clipboard = null);
  }

  ActionContext get _actions => ActionContext(
    tree: _tree,
    focus: _focus,
    clipboard: _clipboard,
    change: _change,
    setClipboard: (c) => setState(() => _clipboard = c),
    edit: _edit,
    open: _open,
    pasteBeside: _pasteBeside,
    pasteInto: _pasteInto,
    addSubgroup: (groupId) => _change(
      appendTo(
        _tree,
        groupId,
        Group(id: newId(), op: GroupOp.any, children: const []),
      ),
    ),
  );

  void _saveCondition(String groupId, Condition? editing, Condition condition) {
    final tree = widget.tree;
    _change(
      editing != null
          ? replaceNode(tree, editing.id, condition)
          : appendTo(tree, groupId, condition),
    );
  }

  /// A condition's editor: a page in the drawer, a tall sheet on a phone.
  void _edit(String groupId, [Condition? condition]) {
    if (widget.docked) {
      setState(() => _editing = (groupId: groupId, condition: condition));
      return;
    }
    showSheet<void>(
      context,
      builder: (sheet) => EditorSheetFrame(
        child: ConditionEditor(
          client: widget.client,
          condition: condition,
          onCancel: () => Navigator.of(sheet).pop(),
          onSave: (c) {
            Navigator.of(sheet).pop();
            _saveCondition(groupId, condition, c);
          },
        ),
      ),
    );
  }

  String _menuCaption(Node node) =>
      node.id == _tree.id ? 'Whole filter · ${summary(node)}' : summary(node);

  void _showMenu(Node node) {
    if (widget.docked) {
      setState(() => _menu = node);
      return;
    }
    showMenuSheet(
      context,
      entries: menuActions(node, _actions),
      caption: _sheetCaption(node),
    );
  }

  String _sheetCaption(Node node) {
    final clipboard = _clipboard;
    if (clipboard != null)
      return '${clipboard.cut ? 'Cut: ' : 'Copied: '}${summary(clipboard.node)}';
    return _menuCaption(node);
  }

  void _showAdd(Group group) {
    if (widget.docked) {
      setState(() => _adding = group);
      return;
    }
    showMenuSheet(
      context,
      entries: addActions(group, _actions),
      caption: 'Add to ${groupLabels[group.op]}',
    );
  }

  void _back() {
    if (_editing != null) {
      setState(() => _editing = null);
    } else if (_menu != null || _adding != null) {
      setState(() => _menu = _adding = null);
    } else if (_levels) {
      setState(() => _levels = false);
    } else if (!_atRoot) {
      _up();
    } else if (_clipboard != null) {
      setState(() => _clipboard = null);
    } else {
      widget.onClose();
    }
  }

  @override
  Widget build(BuildContext context) {
    final focus = _focus;
    final chain = _chain;
    final lines = outline(focus, full: _summaryOpen);
    final folds = lines.any((l) => l.any((r) => r is MoreRun));
    final cutId = _clipboard != null && _clipboard!.cut
        ? _clipboard!.node.id
        : null;
    final conditions = conditionCount(_tree);
    final wireEdited = widget.title == null && _tree.children.isNotEmpty;

    final body = ListView(
      controller: _scroll,
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 20),
      children: [
        TweenAnimationBuilder<double>(
          key: ValueKey(focus.id),
          tween: Tween(begin: _direction * 48.0, end: 0),
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOutCubic,
          builder: (context, dx, child) => Opacity(
            opacity: (1 - dx.abs() / 48).clamp(0.0, 1.0),
            child: Transform.translate(offset: Offset(dx, 0), child: child),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 0, 4, 16),
                child: lines.isEmpty
                    ? Text(
                        _atRoot
                            ? 'All videos. Add a condition to narrow them down.'
                            : 'No conditions in this group yet.',
                        style: inter(
                          13.5,
                          height: 13.5 * 1.6,
                          color: Nocturne.textAlpha(72),
                        ),
                      )
                    : GestureDetector(
                        onTap: folds || _summaryOpen
                            ? () => setState(() => _summaryOpen = !_summaryOpen)
                            : null,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            for (final runs in lines)
                              Text.rich(
                                TextSpan(
                                  children: runSpans(runs, onOpen: _open),
                                ),
                                maxLines: _summaryOpen ? null : 1,
                                overflow: _summaryOpen
                                    ? null
                                    : TextOverflow.ellipsis,
                                style: inter(
                                  13.5,
                                  height: 13.5 * 1.6,
                                  color: Nocturne.textAlpha(72),
                                ),
                              ),
                          ],
                        ),
                      ),
              ),
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  spacing: 8,
                  children: [
                    OpPill(
                      group: focus,
                      root: true,
                      onCycle: () => _cycle(focus),
                    ),
                    if (focus.id == cutId) const CutTag(),
                    Expanded(
                      child: Text(
                        focus.children.isEmpty
                            ? 'empty'
                            : focus.children.length == 1
                            ? 'this 1'
                            : 'these ${focus.children.length}',
                        style: inter(12, color: Nocturne.textAlpha(50)),
                      ),
                    ),
                    CoveIconButton(
                      icon: Phosphor.dotsThreeVertical,
                      onPressed: () => _showMenu(focus),
                      semanticLabel: 'Group menu',
                      box: 34,
                      iconSize: 18,
                      color: Nocturne.textAlpha(45),
                      active: _menu?.id == focus.id,
                    ),
                  ],
                ),
              ),
              Indented(
                children: [
                  for (final child in focus.children)
                    switch (child) {
                      Condition() => ConditionRow(
                        key: ValueKey(child.id),
                        condition: child,
                        cut: child.id == cutId,
                        onPressed: () => _edit(focus.id, child),
                        onMenu: () => _showMenu(child),
                      ),
                      Group() => Subgroup(
                        key: ValueKey(child.id),
                        group: child,
                        cutId: cutId,
                        cameFrom: _cameFrom,
                        canPasteInto: (id) => canPaste(_clipboard, id),
                        onCycle: _cycle,
                        onEdit: (groupId, c) => _edit(groupId, c),
                        onMenu: _showMenu,
                        onOpen: _open,
                        onAdd: _showAdd,
                        onPaste: _pasteInto,
                      ),
                    },
                  AddRow(
                    group: focus,
                    canPasteHere: canPaste(_clipboard, focus.id),
                    onAdd: () => _showAdd(focus),
                    onPaste: () => _pasteInto(focus.id),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );

    final clipboardBar = _clipboard == null
        ? null
        : Container(
            margin: const EdgeInsets.fromLTRB(16, 0, 16, 10),
            padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
            decoration: BoxDecoration(
              color: Nocturne.surface,
              borderRadius: BorderRadius.circular(Nocturne.radiusMd),
              border: Border.all(color: Nocturne.accentAlpha(45)),
            ),
            child: Row(
              spacing: 10,
              children: [
                Icon(
                  _clipboard!.cut ? Phosphor.scissors : Phosphor.copy,
                  size: 18,
                  color: Nocturne.accent300,
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    spacing: 1,
                    children: [
                      Text(
                        _clipboard!.cut
                            ? 'Cut · paste it where it goes'
                            : 'Copied · paste as many copies as you need',
                        style: inter(12, color: Nocturne.textAlpha(55)),
                      ),
                      Text(
                        summary(_clipboard!.node),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: inter(14),
                      ),
                    ],
                  ),
                ),
                CoveIconButton(
                  icon: Phosphor.x,
                  onPressed: () => setState(() => _clipboard = null),
                  semanticLabel: 'Clear the clipboard',
                  box: 34,
                  iconSize: 16,
                  color: Nocturne.textAlpha(55),
                ),
              ],
            ),
          );

    final crumbs = _atRoot
        ? null
        : _Breadcrumbs(
            chain: chain,
            visited: _visited,
            onGo: (g) => _goTo(g, deeper: false),
            onLevels: () => setState(() => _levels = true),
          );

    final countText = _count == null ? '…' : formatCount(_count!);
    final Widget screen;
    if (widget.docked) {
      final sheet = _menu != null
          ? MenuList(
              entries: menuActions(_menu!, _actions),
              caption: _sheetCaption(_menu!),
              onClose: () => setState(() => _menu = null),
            )
          : _adding != null
          ? MenuList(
              entries: addActions(_adding!, _actions),
              caption: 'Add to ${groupLabels[_adding!.op]}',
              onClose: () => setState(() => _adding = null),
            )
          : null;
      screen = Raised(
        on: true,
        child: Stack(
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 14, 12, 4),
                  child: Row(
                    spacing: 6,
                    children: [
                      if (!_atRoot)
                        CoveIconButton(
                          icon: Phosphor.caretLeft,
                          onPressed: _up,
                          semanticLabel: 'Up one level',
                          box: 40,
                          iconSize: 20,
                        ),
                      if (_atRoot) const SizedBox(width: 8),
                      Text('Filter', style: inter(17, weight: medium)),
                      Expanded(
                        child: Text(
                          '$conditions condition${conditions == 1 ? '' : 's'}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: inter(12.5, color: Nocturne.textAlpha(55)),
                        ),
                      ),
                      CloseIconButton(onPressed: widget.onClose),
                    ],
                  ),
                ),
                if (widget.title != null)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 0, 20, 4),
                    child: Row(
                      spacing: 6,
                      children: [
                        Icon(
                          Phosphor.fill(Phosphor.bookmarksSimple),
                          size: 15,
                          color: Nocturne.accent300,
                        ),
                        Flexible(
                          child: Text(
                            widget.title!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: inter(13, color: Nocturne.textAlpha(75)),
                          ),
                        ),
                        if (widget.savedEdited) const EditedTag(),
                      ],
                    ),
                  ),
                ?crumbs,
                Expanded(child: body),
                ?clipboardBar,
                if (_editing == null)
                  Container(
                    padding: const EdgeInsets.fromLTRB(20, 12, 14, 14),
                    decoration: BoxDecoration(
                      border: Border(top: BorderSide(color: Nocturne.divider)),
                    ),
                    child: Row(
                      spacing: 12,
                      children: [
                        Expanded(
                          child: Text.rich(
                            TextSpan(
                              children: [
                                TextSpan(
                                  text: countText,
                                  style: inter(13, weight: medium),
                                ),
                                const TextSpan(text: ' videos match'),
                              ],
                            ),
                            style: inter(13, color: Nocturne.textAlpha(60)),
                          ),
                        ),
                        if (widget.saveLabel != null && widget.onSave != null)
                          CoveButton(
                            label: widget.saveLabel!,
                            onPressed: widget.onSave!,
                          ),
                        CoveButton(
                          label: 'Done',
                          variant: ButtonVariant.secondary,
                          onPressed: widget.onClose,
                        ),
                      ],
                    ),
                  ),
              ],
            ),
            if (_levels)
              _LevelsOverlay(
                chain: chain,
                visited: _visited,
                onGo: (g) => _goTo(g, deeper: false),
                onClose: () => setState(() => _levels = false),
              ),
            InlineSheet(
              onClose: () => setState(() => _menu = _adding = null),
              child: sheet,
            ),
            if (_editing != null)
              Positioned.fill(
                child: TweenAnimationBuilder<double>(
                  tween: Tween(begin: 1, end: 0),
                  duration: const Duration(milliseconds: 280),
                  curve: const Cubic(0.2, 0.8, 0.2, 1),
                  builder: (context, t, child) => Transform.translate(
                    offset: Offset(t * 420, 0),
                    child: child,
                  ),
                  child: ColoredBox(
                    color: Nocturne.surface,
                    child: ConditionEditor(
                      key: ValueKey(
                        _editing!.condition?.id ?? 'new-${_editing!.groupId}',
                      ),
                      client: widget.client,
                      condition: _editing!.condition,
                      onCancel: () => setState(() => _editing = null),
                      onSave: (c) {
                        final editing = _editing!;
                        setState(() => _editing = null);
                        _saveCondition(editing.groupId, editing.condition, c);
                      },
                    ),
                  ),
                ),
              ),
          ],
        ),
      );
    } else {
      final top = MediaQuery.paddingOf(context).top,
          bottom = MediaQuery.paddingOf(context).bottom;
      screen = ColoredBox(
        color: Nocturne.bg,
        child: Stack(
          children: [
            Padding(
              padding: EdgeInsets.only(top: top),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(4, 4, 12, 0),
                    child: Row(
                      spacing: 6,
                      children: [
                        CoveIconButton(
                          icon: Phosphor.caretLeft,
                          onPressed: _atRoot ? widget.onClose : _up,
                          semanticLabel: _atRoot
                              ? 'Close the filter'
                              : 'Up one level',
                          iconSize: 20,
                        ),
                        Flexible(
                          child: Text(
                            widget.title ?? 'New filter',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: inter(17, weight: medium),
                          ),
                        ),
                        if (widget.savedEdited || wireEdited) const EditedTag(),
                        const Spacer(),
                        if (widget.saveLabel != null && widget.onSave != null)
                          CoveButton(
                            label: widget.saveLabel!,
                            size: ButtonSize.sm,
                            onPressed: widget.onSave!,
                          ),
                      ],
                    ),
                  ),
                  ?crumbs,
                  Expanded(child: body),
                  ?clipboardBar,
                  Container(
                    padding: EdgeInsets.fromLTRB(16, 12, 16, 12 + bottom),
                    decoration: BoxDecoration(
                      color: Nocturne.bg,
                      border: Border(top: BorderSide(color: Nocturne.divider)),
                    ),
                    child: Row(
                      spacing: 8,
                      children: [
                        CoveButton(
                          label: 'Play all',
                          variant: ButtonVariant.secondary,
                          size: ButtonSize.lg,
                          icon: Phosphor.fill(Phosphor.play),
                          onPressed: () => widget.onPlayAll?.call(_tree),
                        ),
                        Expanded(
                          child: CoveButton(
                            label: 'Show $countText videos',
                            size: ButtonSize.lg,
                            onPressed: () => widget.onApply?.call(_tree),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            if (_levels)
              _LevelsOverlay(
                chain: chain,
                visited: _visited,
                onGo: (g) => _goTo(g, deeper: false),
                onClose: () => setState(() => _levels = false),
              ),
          ],
        ),
      );
    }
    return BackHandler(
      layer: Layer.editor,
      enabled: true,
      onBack: _back,
      child: screen,
    );
  }
}

/// "Edited": a saved filter changed (11 px, accent-800 / accent-100).
class EditedTag extends StatelessWidget {
  const EditedTag({super.key});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
    decoration: BoxDecoration(
      color: Nocturne.accent800,
      borderRadius: BorderRadius.circular(5),
    ),
    child: Text('Edited', style: inter(11, color: Nocturne.accent100)),
  );
}

/// Design 5c / 5d: the levels opened, as chips ("Filter" › Any of › All of; tap jumps back); past four levels the
/// middle folds into "…" (it lists them).
class _Breadcrumbs extends StatelessWidget {
  const _Breadcrumbs({
    required this.chain,
    required this.visited,
    required this.onGo,
    required this.onLevels,
  });

  final List<Group> chain;
  final Set<String> visited;
  final ValueChanged<Group> onGo;
  final VoidCallback onLevels;

  @override
  Widget build(BuildContext context) {
    final folded = chain.length > 4;
    final shown = folded
        ? [chain.first, null, ...chain.sublist(chain.length - 2)]
        : chain;
    return SizedBox(
      height: 40,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        children: [
          for (final (i, g) in shown.indexed) ...[
            if (i > 0)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: Icon(
                  Phosphor.caretRight,
                  size: 11,
                  color: Nocturne.textAlpha(45),
                ),
              ),
            _Crumb(
              label: g == null
                  ? '…'
                  : (g == chain.first ? 'Filter' : groupLabels[g.op]!),
              icon: g == chain.first ? Phosphor.funnelSimple : null,
              last: i == shown.length - 1,
              enabled: g == null || visited.contains(g.id),
              onPressed: g == null
                  ? onLevels
                  : (i == shown.length - 1 ? null : () => onGo(g)),
            ),
          ],
        ],
      ),
    );
  }
}

class _Crumb extends StatelessWidget {
  const _Crumb({
    required this.label,
    required this.last,
    required this.enabled,
    required this.onPressed,
    this.icon,
  });

  final String label;
  final IconData? icon;
  final bool last;
  final bool enabled;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final color = last
        ? Nocturne.accent300
        : Nocturne.textAlpha(enabled ? 70 : 35);
    return Pressable(
      onPressed: enabled ? onPressed : null,
      semanticLabel: label,
      builder: (context, states) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: last ? Nocturne.accentAlpha(45) : Nocturne.divider,
          ),
          color: states.highlighted ? Nocturne.textAlpha(6) : null,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          spacing: 5,
          children: [
            if (icon != null) Icon(icon, size: 13, color: color),
            Text(label, style: inter(12.5, color: color)),
          ],
        ),
      ),
    );
  }
}

/// Design 5d: the folded levels, listed (the ones skipped on the way only named).
class _LevelsOverlay extends StatelessWidget {
  const _LevelsOverlay({
    required this.chain,
    required this.visited,
    required this.onGo,
    required this.onClose,
  });

  final List<Group> chain;
  final Set<String> visited;
  final ValueChanged<Group> onGo;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) => Positioned.fill(
    child: GestureDetector(
      onTap: onClose,
      child: ColoredBox(
        color: const Color(0x66292B31),
        child: Stack(
          children: [
            Positioned(
              top: 84,
              left: 56,
              right: 16,
              child: Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: Nocturne.surface,
                  borderRadius: BorderRadius.circular(Nocturne.radiusMd),
                  border: Border.all(color: Nocturne.divider),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x73000000),
                      offset: Offset(0, 20),
                      blurRadius: 40,
                    ),
                  ],
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final (i, g)
                        in chain.sublist(1, chain.length - 2).indexed)
                      Opacity(
                        opacity: visited.contains(g.id) ? 1 : 0.5,
                        child: Pressable(
                          onPressed: visited.contains(g.id)
                              ? () => onGo(g)
                              : null,
                          semanticLabel: groupLabels[g.op],
                          builder: (context, states) => Container(
                            constraints: const BoxConstraints(minHeight: 56),
                            padding: EdgeInsets.fromLTRB(
                              12.0 + i * 14,
                              6,
                              12,
                              6,
                            ),
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(
                                Nocturne.radiusMd,
                              ),
                              color: states.pressed || states.highlighted
                                  ? Nocturne.accentAlpha(10)
                                  : null,
                            ),
                            child: Row(
                              spacing: 12,
                              children: [
                                Icon(
                                  Phosphor.arrowElbowDownRight,
                                  size: 16,
                                  color: Nocturne.textAlpha(45),
                                ),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    spacing: 2,
                                    children: [
                                      Text(
                                        groupLabels[g.op]!,
                                        style: inter(14, weight: medium),
                                      ),
                                      Text(
                                        runsText(groupPhrase(g)),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: inter(
                                          12,
                                          color: Nocturne.textAlpha(55),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    Container(
                      margin: const EdgeInsets.symmetric(
                        vertical: 4,
                        horizontal: 12,
                      ),
                      height: 1,
                      color: Nocturne.divider,
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(12, 6, 12, 8),
                      child: Text(
                        'Then ${chain.sublist(chain.length - 2).map((g) => groupLabels[g.op]).join(' › ')} (here)',
                        style: inter(12, color: Nocturne.textAlpha(50)),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

/// The drawer the filter sits in on a tablet: 420 wide, as the design's 2d.
const filterDrawerWidth = 420.0;
