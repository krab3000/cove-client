import type { MenuEntry } from '../../ui/Menu';
import {
  GROUP_LABELS,
  canPaste,
  conditionCount,
  contains,
  findParent,
  removeNode,
  simplifiable,
  simplify,
  summary,
  ungroup,
  wrapNode,
  type Clipboard,
  type Condition,
  type Group,
  type Node,
} from './model';

/** What the editor's menus act on, and how they act. */
export interface ActionContext {
  tree: Group;
  // The level shown
  focus: Group;
  clipboard: Clipboard | null;
  // The node cut, if the clipboard holds a cut
  cutId: string | null;
  change: (tree: Group) => void;
  setClipboard: (clipboard: Clipboard | null) => void;
  // A condition to edit in its sheet (or a new one, in a group)
  edit: (groupId: string, condition?: Condition) => void;
  open: (group: Group) => void;
  pasteBeside: (id: string, where: 'before' | 'after') => void;
  pasteInto: (groupId: string) => void;
  addSubgroup: (groupId: string) => void;
}

/** Design 4a / 4c: what an item's ⋮ offers, only what applies there. */
export function menuActions(node: Node, ctx: ActionContext): MenuEntry[] {
  const { tree, focus, clipboard, cutId, change } = ctx;
  const isRoot = node.id === tree.id;
  const actions: MenuEntry[] = [];
  if (node.kind === 'group' && node.id !== focus.id)
    actions.push({
      icon: 'arrow-square-in',
      label: 'Open',
      onPress: () => ctx.open(node),
    });
  if (node.kind === 'condition')
    actions.push({
      icon: 'pencil-simple',
      label: 'Edit condition',
      onPress: () => ctx.edit(tree.id, node),
    });
  if (!isRoot)
    actions.push({
      icon: 'scissors',
      label: 'Cut',
      onPress: () => ctx.setClipboard({ node, mode: 'cut' }),
    });
  actions.push({
    icon: 'copy',
    label: 'Copy',
    onPress: () => ctx.setClipboard({ node, mode: 'copy' }),
  });
  if (!isRoot && canPaste(clipboard, node.id)) {
    actions.push(
      {
        icon: 'arrow-line-up',
        label: 'Paste before',
        onPress: () => ctx.pasteBeside(node.id, 'before'),
      },
      {
        icon: 'arrow-line-down',
        label: 'Paste after',
        onPress: () => ctx.pasteBeside(node.id, 'after'),
      }
    );
  }
  actions.push({
    icon: 'brackets-curly',
    label: 'Wrap in group',
    detail: isRoot ? 'Put the whole filter in a new All of group' : undefined,
    onPress: () => change(wrapNode(tree, node.id)),
  });
  if (node.kind === 'group' && !isRoot) {
    const parent = findParent(tree, node.id)?.parent;
    const items = node.children.length;
    const allConditions = node.children.every((c) => c.kind === 'condition');
    const noun = allConditions ? 'condition' : 'item';
    actions.push({
      icon: 'arrow-elbow-up-left',
      label: 'Ungroup',
      detail: items
        ? `Move its ${items} ${noun}${items === 1 ? '' : 's'} into ${parent ? GROUP_LABELS[parent.op] : 'its parent'}`
        : 'Remove the empty group',
      onPress: () => change(ungroup(tree, node.id)),
    });
  }
  // Design 5f: groups that change nothing, merged into their parent
  const merges = isRoot ? simplifiable(tree) : 0;
  if (merges)
    actions.push({
      icon: 'magic-wand',
      label: 'Simplify',
      detail: `Merge ${merges} group${merges === 1 ? '' : 's'} that don't change the result`,
      onPress: () => change(simplify(tree)),
    });
  actions.push('rule');
  if (isRoot) {
    actions.push({
      icon: 'eraser',
      label: 'Clear all',
      onPress: () => {
        change({ ...tree, children: [] });
        ctx.setClipboard(null);
      },
    });
  } else if (node.kind === 'group') {
    const inside = conditionCount(node);
    actions.push({
      icon: 'trash',
      label: inside
        ? `Remove group and its ${inside} condition${inside === 1 ? '' : 's'}`
        : 'Remove group',
      onPress: () => {
        change(removeNode(tree, node.id));
        if (cutId && contains(node, cutId)) ctx.setClipboard(null);
      },
    });
  } else {
    actions.push({
      icon: 'trash',
      label: 'Remove condition',
      onPress: () => {
        change(removeNode(tree, node.id));
        if (cutId === node.id) ctx.setClipboard(null);
      },
    });
  }
  return actions;
}

/** Design 5e: what "+ Add" offers in a group. */
export function addActions(group: Group, ctx: ActionContext): MenuEntry[] {
  const { clipboard } = ctx;
  const actions: MenuEntry[] = [
    {
      icon: 'plus',
      label: 'Condition',
      detail: 'A rule on one field',
      onPress: () => ctx.edit(group.id),
    },
    {
      icon: 'brackets-curly',
      label: 'Subgroup',
      detail: 'A new Any of group inside this one',
      onPress: () => ctx.addSubgroup(group.id),
    },
  ];
  if (clipboard && canPaste(clipboard, group.id))
    actions.push('rule', {
      icon: 'clipboard-text',
      label: `Paste “${summary(clipboard.node)}”`,
      detail: clipboard.mode === 'cut' ? 'Moves it here' : 'Adds a copy here',
      onPress: () => ctx.pasteInto(group.id),
    });
  return actions;
}
