import '../../ui/icons.dart';
import '../../ui/misc.dart';
import '../../ui/popover.dart';
import 'model.dart';

/// What the editor's menus act on, and how they act.
class ActionContext {
  const ActionContext({
    required this.tree,
    required this.focus,
    required this.clipboard,
    required this.change,
    required this.setClipboard,
    required this.edit,
    required this.open,
    required this.pasteBeside,
    required this.pasteInto,
    required this.addSubgroup,
  });

  final Group tree;
  // The level shown
  final Group focus;
  final Clipboard? clipboard;
  final void Function(Group tree) change;
  final void Function(Clipboard? clipboard) setClipboard;
  // A condition to edit (or a new one, in a group)
  final void Function(String groupId, [Condition? condition]) edit;
  final void Function(Group group) open;
  final void Function(String id, {required bool before}) pasteBeside;
  final void Function(String groupId) pasteInto;
  final void Function(String groupId) addSubgroup;

  String? get cutId =>
      clipboard != null && clipboard!.cut ? clipboard!.node.id : null;
}

/// Design 4a / 4c: what an item's ⋮ offers, only what applies there. [MenuEntry]s and [Rule]s.
List<Object> menuActions(Node node, ActionContext ctx) {
  final tree = ctx.tree;
  final isRoot = node.id == tree.id;
  final actions = <Object>[
    if (node is Group && node.id != ctx.focus.id)
      MenuEntry(
        icon: Phosphor.arrowSquareIn,
        label: 'Open',
        onPressed: () => ctx.open(node),
      ),
    if (node is Condition)
      MenuEntry(
        icon: Phosphor.pencilSimple,
        label: 'Edit condition',
        onPressed: () => ctx.edit(tree.id, node),
      ),
    if (!isRoot)
      MenuEntry(
        icon: Phosphor.scissors,
        label: 'Cut',
        onPressed: () => ctx.setClipboard(Clipboard(node, cut: true)),
      ),
    MenuEntry(
      icon: Phosphor.copy,
      label: 'Copy',
      onPressed: () => ctx.setClipboard(Clipboard(node, cut: false)),
    ),
    if (!isRoot && canPaste(ctx.clipboard, node.id)) ...[
      MenuEntry(
        icon: Phosphor.arrowLineUp,
        label: 'Paste before',
        onPressed: () => ctx.pasteBeside(node.id, before: true),
      ),
      MenuEntry(
        icon: Phosphor.arrowLineDown,
        label: 'Paste after',
        onPressed: () => ctx.pasteBeside(node.id, before: false),
      ),
    ],
    MenuEntry(
      icon: Phosphor.bracketsCurly,
      label: 'Wrap in group',
      detail: isRoot ? 'Put the whole filter in a new All of group' : null,
      onPressed: () => ctx.change(wrapNode(tree, node.id)),
    ),
  ];
  if (node is Group && !isRoot) {
    final parent = findParent(tree, node.id)?.parent;
    final items = node.children.length;
    final noun = node.children.every((c) => c is Condition)
        ? 'condition'
        : 'item';
    actions.add(
      MenuEntry(
        icon: Phosphor.arrowElbowUpLeft,
        label: 'Ungroup',
        detail: items > 0
            ? 'Move its $items $noun${items == 1 ? '' : 's'} into ${parent != null ? groupLabels[parent.op] : 'its parent'}'
            : 'Remove the empty group',
        onPressed: () => ctx.change(ungroup(tree, node.id)),
      ),
    );
  }
  // Design 5f: groups that change nothing, merged into their parent
  final merges = isRoot ? simplifiable(tree) : 0;
  if (merges > 0) {
    actions.add(
      MenuEntry(
        icon: Phosphor.magicWand,
        label: 'Simplify',
        detail:
            "Merge $merges group${merges == 1 ? '' : 's'} that don't change the result",
        onPressed: () => ctx.change(simplify(tree)),
      ),
    );
  }
  actions.add(const Rule());
  final cutId = ctx.cutId;
  if (isRoot) {
    actions.add(
      MenuEntry(
        icon: Phosphor.eraser,
        label: 'Clear all',
        onPressed: () {
          ctx.change(tree.copyWith(children: const []));
          ctx.setClipboard(null);
        },
      ),
    );
  } else if (node is Group) {
    final inside = conditionCount(node);
    actions.add(
      MenuEntry(
        icon: Phosphor.trash,
        label: inside > 0
            ? 'Remove group and its $inside condition${inside == 1 ? '' : 's'}'
            : 'Remove group',
        onPressed: () {
          ctx.change(removeNode(tree, node.id));
          if (cutId != null && nodeContains(node, cutId))
            ctx.setClipboard(null);
        },
      ),
    );
  } else {
    actions.add(
      MenuEntry(
        icon: Phosphor.trash,
        label: 'Remove condition',
        onPressed: () {
          ctx.change(removeNode(tree, node.id));
          if (cutId == node.id) ctx.setClipboard(null);
        },
      ),
    );
  }
  return actions;
}

/// Design 5e: what "+ Add" offers in a group.
List<Object> addActions(Group group, ActionContext ctx) {
  final clipboard = ctx.clipboard;
  return [
    MenuEntry(
      icon: Phosphor.plus,
      label: 'Condition',
      detail: 'A rule on one field',
      onPressed: () => ctx.edit(group.id),
    ),
    MenuEntry(
      icon: Phosphor.bracketsCurly,
      label: 'Subgroup',
      detail: 'A new Any of group inside this one',
      onPressed: () => ctx.addSubgroup(group.id),
    ),
    if (clipboard != null && canPaste(clipboard, group.id)) ...[
      const Rule(),
      MenuEntry(
        icon: Phosphor.clipboardText,
        label: 'Paste “${summary(clipboard.node)}”',
        detail: clipboard.cut ? 'Moves it here' : 'Adds a copy here',
        onPressed: () => ctx.pasteInto(group.id),
      ),
    ],
  ];
}
