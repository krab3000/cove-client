import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  createContext,
  useContext,
} from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { CoveClient } from '../api/cove';
import type { FilterExpression } from '../api/types';
import { ConditionSheet } from '../components/ConditionSheet';
import { formatCount } from '../lib/format';
import { Button } from '../ui/Button';
import { Icon, type IconName } from '../ui/Icon';
import { BackButton, IconButton, MoreButton } from '../ui/IconButton';
import { PanelHeader } from '../ui/PanelHeader';
import {
  GROUP_LABELS,
  appendTo,
  canPaste,
  conditionCount,
  contains,
  findChain,
  findNode,
  findParent,
  groupPhrase,
  newId,
  nextOp,
  outline,
  paste,
  removeNode,
  replaceNode,
  rowText,
  runsText,
  simplifiable,
  simplify,
  summary,
  toWire,
  ungroup,
  wrapNode,
  type Clipboard,
  type Condition,
  type Group,
  type Node,
  type SummaryRun,
} from '../filter/model';
import { fonts, nocturne as n } from '../theme/tokens';
import { useSafeInsets } from '../platform/insets';
import { EditedTag } from '../ui/Chip';
import { MenuSheet } from '../ui/Menu';
import { Layer, useBackHandler } from '../app/back';
import { useVideoCount } from '../data/library';
import { useDebouncedValue } from '../lib/timers';

/**
 * Design 2b (design_handoff_cove_mobile, "Rule tree as an outline"), for phones: a Cove filter as an outline of
 * groups and conditions, with a short summary on top and the live result count in the footer. Tapping a group's pill
 * cycles All / Any / Just one / None. Nesting is indentation with a guide line, not boxes in boxes.
 * Design 5a–5f: the outline shows the group you are in and one level of subgroups; deeper groups are rows that open
 * as their own level, on the same screen, with a breadcrumb.
 */
export function FilterScreen({
  client,
  tree,
  onChange,
  applied,
  onApply,
  onPlayAll,
  onClose,
  title,
  docked,
  savedEdited,
  saveLabel,
  onSave,
}: {
  client: CoveClient;
  tree: Group;
  onChange: (tree: Group) => void;
  /** The filter the main screen shows now */
  applied: FilterExpression | null;
  onApply: (filter: FilterExpression | null) => void;
  onPlayAll: (filter: FilterExpression | null) => void;
  onClose: () => void;
  /** The saved filter being edited, if any */
  title?: string;
  /**
   * Tablet (design 2d): a column beside the results instead of a screen over them. "Filter · N conditions" and
   * close on top, the live count and Done at the bottom; no Show / Play all, as the results behind it follow the tree
   * as it changes.
   */
  docked?: boolean;
  // Docked: the saved filter is changed (Edited by its name). What saving does ("Save" / "Save as…", or null when
  // there is nothing to save) and doing it: saving is the editor's (the phone's header, the tablet drawer's footer).
  savedEdited?: boolean;
  saveLabel?: string | null;
  onSave?: () => void;
}) {
  const insets = useSafeInsets();
  const wire = useMemo(() => toWire(tree), [tree]);
  const wireJson = JSON.stringify(wire);
  const edited = wireJson !== JSON.stringify(applied ?? null);
  // The live count, once the tree has settled for a moment
  const settledWire = useDebouncedValue(wireJson, 300);
  const count = useVideoCount(JSON.parse(settledWire), undefined) ?? null;
  const [editing, setEditing] = useState<{
    groupId: string;
    condition?: Condition;
  } | null>(null);
  const [menu, setMenu] = useState<Node | null>(null);
  // Design 5e: what "+ Add" adds to
  const [adding, setAdding] = useState<Group | null>(null);
  // Design 4b: a cut item stays in place (dimmed) until a paste moves it; a copy pastes as new copies.
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const cutId = clipboard?.mode === 'cut' ? clipboard.node.id : null;
  const pasteInto = (groupId: string) => {
    if (!clipboard) return;
    onChange(paste(tree, clipboard, { into: groupId }));
    if (clipboard.mode === 'cut') setClipboard(null);
  };
  const pasteBeside = (id: string, where: 'before' | 'after') => {
    if (!clipboard) return;
    onChange(paste(tree, clipboard, { at: id, where }));
    if (clipboard.mode === 'cut') setClipboard(null);
  };
  // A cut item that is gone from the tree (removed, merged by Simplify) can't be pasted any more.
  useEffect(() => {
    if (cutId && !findNode(tree, cutId)) setClipboard(null);
  }, [tree, cutId]);

  // Design 5c: the groups opened on the way here, in order; the last one still in the tree is open. If it goes
  // (removed, ungrouped), the one opened before it is; if it moves (cut and pasted), it stays open where it went.
  const [opened, setOpened] = useState<string[]>([]);
  const chain = useMemo(() => {
    for (let i = opened.length - 1; i >= 0; i--) {
      const found = findChain(tree, opened[i]!);
      if (found) return found;
    }
    return [tree];
  }, [tree, opened]);
  const focus = chain[chain.length - 1]!;
  const atRoot = chain.length === 1;
  // The levels back and the breadcrumb go to: the root and the groups opened. A level skipped on the way (a row two
  // levels down opens directly) is only named.
  const visited = useMemo(
    () =>
      new Set([
        tree.id,
        ...opened.filter((id) => chain.some((g) => g.id === id)),
      ]),
    [tree.id, opened, chain]
  );
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [levels, setLevels] = useState(false);
  // Design 5b: the group just come back from, ringed for a moment
  const [cameFrom, setCameFrom] = useState<string | null>(null);
  useEffect(() => {
    if (!cameFrom) return;
    const timer = setTimeout(() => setCameFrom(null), 1400);
    return () => clearTimeout(timer);
  }, [cameFrom]);

  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const offsets = useRef(new Map<string, number>());
  const slide = useRef(new Animated.Value(0)).current;
  const direction = useRef(0);
  const goTo = (target: Group, deeper: boolean) => {
    const next = findChain(tree, target.id);
    if (!next) return;
    direction.current = deeper ? 1 : -1;
    // Back up: ring the level opened from there, the row (or subgroup) it shows
    if (!deeper)
      setCameFrom(
        chain.slice(next.length).find((g) => visited.has(g.id))?.id ?? null
      );
    setOpened([
      ...opened.filter(
        (id) => id !== target.id && next.some((g) => g.id === id)
      ),
      ...(target.id === tree.id ? [] : [target.id]),
    ]);
    setSummaryOpen(false);
    setLevels(false);
  };
  const open = (group: Group) => goTo(group, true);
  const up = () =>
    goTo(
      chain
        .slice(0, -1)
        .reverse()
        .find((g) => visited.has(g.id)) ?? tree,
      false
    );
  // A level slides in from the side it comes from, and keeps where it was scrolled to.
  useEffect(() => {
    if (!direction.current) return;
    slide.setValue(direction.current * 48);
    direction.current = 0;
    Animated.timing(slide, {
      toValue: 0,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    const y = offsets.current.get(focus.id) ?? 0;
    requestAnimationFrame(() =>
      scroll.current?.scrollTo({ y, animated: false })
    );
  }, [focus.id, slide]);

  useBackHandler(() => {
    if (editing) setEditing(null);
    else if (menu) setMenu(null);
    else if (adding) setAdding(null);
    else if (levels) setLevels(false);
    else if (!atRoot) up();
    else if (clipboard) setClipboard(null);
    else onClose();
  }, Layer.editor);

  // Design 4a / 4c: what an item's ⋮ offers, only what applies there.
  type Action = {
    icon: IconName;
    label: string;
    detail?: string;
    run: () => void;
  };
  const menuActions = (node: Node): (Action | 'rule')[] => {
    const isRoot = node.id === tree.id;
    const actions: (Action | 'rule')[] = [];
    if (node.kind === 'group' && node.id !== focus.id)
      actions.push({
        icon: 'arrow-square-in',
        label: 'Open',
        run: () => open(node),
      });
    if (node.kind === 'condition')
      actions.push({
        icon: 'pencil-simple',
        label: 'Edit condition',
        run: () => setEditing({ groupId: tree.id, condition: node }),
      });
    if (!isRoot)
      actions.push({
        icon: 'scissors',
        label: 'Cut',
        run: () => setClipboard({ node, mode: 'cut' }),
      });
    actions.push({
      icon: 'copy',
      label: 'Copy',
      run: () => setClipboard({ node, mode: 'copy' }),
    });
    if (!isRoot && canPaste(clipboard, node.id)) {
      actions.push(
        {
          icon: 'arrow-line-up',
          label: 'Paste before',
          run: () => pasteBeside(node.id, 'before'),
        },
        {
          icon: 'arrow-line-down',
          label: 'Paste after',
          run: () => pasteBeside(node.id, 'after'),
        }
      );
    }
    actions.push({
      icon: 'brackets-curly',
      label: 'Wrap in group',
      detail: isRoot ? 'Put the whole filter in a new All of group' : undefined,
      run: () => onChange(wrapNode(tree, node.id)),
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
        run: () => onChange(ungroup(tree, node.id)),
      });
    }
    // Design 5f: groups that change nothing, merged into their parent
    const merges = isRoot ? simplifiable(tree) : 0;
    if (merges)
      actions.push({
        icon: 'magic-wand',
        label: 'Simplify',
        detail: `Merge ${merges} group${merges === 1 ? '' : 's'} that don't change the result`,
        run: () => onChange(simplify(tree)),
      });
    actions.push('rule');
    if (isRoot) {
      actions.push({
        icon: 'eraser',
        label: 'Clear all',
        run: () => {
          onChange({ ...tree, children: [] });
          setClipboard(null);
        },
      });
    } else if (node.kind === 'group') {
      const inside = conditionCount(node);
      actions.push({
        icon: 'trash',
        label: inside
          ? `Remove group and its ${inside} condition${inside === 1 ? '' : 's'}`
          : 'Remove group',
        run: () => {
          onChange(removeNode(tree, node.id));
          if (cutId && contains(node, cutId)) setClipboard(null);
        },
      });
    } else {
      actions.push({
        icon: 'trash',
        label: 'Remove condition',
        run: () => {
          onChange(removeNode(tree, node.id));
          if (cutId === node.id) setClipboard(null);
        },
      });
    }
    return actions;
  };

  // Design 5e: what "+ Add" offers in a group
  const addActions = (group: Group): (Action | 'rule')[] => {
    const actions: (Action | 'rule')[] = [
      {
        icon: 'plus',
        label: 'Condition',
        detail: 'A rule on one field',
        run: () => setEditing({ groupId: group.id }),
      },
      {
        icon: 'brackets-curly',
        label: 'Subgroup',
        detail: 'A new Any of group inside this one',
        run: () => addSubgroup(group.id),
      },
    ];
    if (clipboard && canPaste(clipboard, group.id))
      actions.push('rule', {
        icon: 'clipboard-text',
        label: `Paste “${summary(clipboard.node)}”`,
        detail: clipboard.mode === 'cut' ? 'Moves it here' : 'Adds a copy here',
        run: () => pasteInto(group.id),
      });
    return actions;
  };

  const cycle = (group: Group) =>
    onChange(replaceNode(tree, group.id, { ...group, op: nextOp(group.op) }));
  const addSubgroup = (groupId: string) =>
    onChange(
      appendTo(tree, groupId, {
        kind: 'group',
        id: newId(),
        op: 'any',
        children: [],
      })
    );

  const lines = outline(focus, summaryOpen);
  const folds = lines.some((l) => l.some((r) => r.kind === 'more'));
  const sheet = menu
    ? {
        title:
          menu.id === tree.id
            ? `Whole filter · ${summary(menu)}`
            : summary(menu),
        actions: menuActions(menu),
      }
    : adding
      ? {
          title: `Add to ${GROUP_LABELS[adding.op]}`,
          actions: addActions(adding),
        }
      : null;
  const closeSheet = () => {
    setMenu(null);
    setAdding(null);
  };

  return (
    <Raised.Provider value={!!docked}>
      <View
        style={
          docked
            ? styles.docked
            : [
                styles.screen,
                {
                  top: -insets.top,
                  bottom: -insets.bottom,
                  paddingTop: insets.top,
                  paddingBottom: insets.bottom,
                },
              ]
        }
      >
        {docked ? (
          <PanelHeader
            title="Filter"
            detail={
              conditionCount(tree) === 1
                ? '1 condition'
                : `${conditionCount(tree)} conditions`
            }
            left={
              atRoot ? null : (
                <BackButton onPress={up} accessibilityLabel="Up one level" />
              )
            }
            onClose={onClose}
            closeLabel="Close the filter"
          />
        ) : null}
        {docked && title ? (
          <View style={styles.dockedSaved}>
            <Icon name="bookmarks-simple" fill size={15} color={n.accent300} />
            <Text style={styles.dockedSavedName} numberOfLines={1}>
              {title}
            </Text>
            {savedEdited ? <EditedTag /> : null}
          </View>
        ) : null}
        <View style={[styles.header, docked && styles.hidden]}>
          <BackButton
            onPress={atRoot ? onClose : up}
            accessibilityLabel={atRoot ? 'Close the filter' : 'Up one level'}
          />
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              {title ?? 'New filter'}
            </Text>
            {edited && tree.children.length ? <EditedTag /> : null}
          </View>
          {saveLabel && onSave ? (
            <Button
              label={saveLabel}
              size="sm"
              onPress={onSave}
              style={styles.headerSave}
            />
          ) : null}
        </View>
        {atRoot ? null : (
          <Crumbs
            chain={chain}
            visited={visited}
            levelsOpen={levels}
            onGo={(g) => goTo(g, false)}
            onLevels={() => setLevels(true)}
          />
        )}

        <ScrollView
          ref={scroll}
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          scrollEventThrottle={32}
          onScroll={(e) =>
            offsets.current.set(focus.id, e.nativeEvent.contentOffset.y)
          }
        >
          <Animated.View
            style={{
              transform: [{ translateX: slide }],
              opacity: slide.interpolate({
                inputRange: [-48, 0, 48],
                outputRange: [0, 1, 0],
              }),
            }}
          >
            {lines.length ? (
              <Pressable
                onPress={
                  folds || summaryOpen
                    ? () => setSummaryOpen((o) => !o)
                    : undefined
                }
                style={styles.summary}
              >
                {lines.map((runs, i) => (
                  <Text
                    key={i}
                    style={styles.summaryLine}
                    numberOfLines={summaryOpen ? undefined : 1}
                  >
                    <Runs runs={runs} onOpen={open} />
                  </Text>
                ))}
              </Pressable>
            ) : (
              <Text style={[styles.summary, styles.summaryLine]}>
                {atRoot
                  ? 'All videos. Add a condition to narrow them down.'
                  : 'No conditions in this group yet.'}
              </Text>
            )}
            <View style={styles.rootRow}>
              <Pressable
                onPress={() => cycle(focus)}
                style={[styles.pill, styles.rootPill]}
              >
                <Text style={[styles.pillText, styles.rootPillText]}>
                  {GROUP_LABELS[focus.op]}
                </Text>
                <Icon name="caret-up-down" size={13} color={n.accent200} />
              </Pressable>
              {focus.id === cutId ? <CutTag /> : null}
              <Text style={styles.these}>
                {focus.children.length === 0
                  ? 'empty'
                  : focus.children.length === 1
                    ? 'this 1'
                    : `these ${focus.children.length}`}
              </Text>
              <MoreButton
                size="sm"
                onPress={() => setMenu(focus)}
                accessibilityLabel="Group menu"
              />
            </View>
            <View style={styles.children}>
              <View style={[styles.guide, styles.guideRoot]} />
              {focus.children.map((child) =>
                child.kind === 'condition' ? (
                  <ConditionRow
                    key={child.id}
                    condition={child}
                    cut={child.id === cutId}
                    onPress={() =>
                      setEditing({ groupId: focus.id, condition: child })
                    }
                    onMenu={() => setMenu(child)}
                  />
                ) : (
                  <Subgroup
                    key={child.id}
                    group={child}
                    cutId={cutId}
                    cameFrom={cameFrom}
                    clipboard={clipboard}
                    onCycle={cycle}
                    onEdit={(groupId, condition) =>
                      setEditing({ groupId, condition })
                    }
                    onMenu={setMenu}
                    onOpen={open}
                    onAdd={setAdding}
                    onPaste={pasteInto}
                  />
                )
              )}
              <AddRow
                group={focus}
                clipboard={clipboard}
                onAdd={setAdding}
                onPaste={pasteInto}
              />
            </View>
          </Animated.View>
        </ScrollView>

        {clipboard ? (
          <View style={styles.clipboardBar}>
            <Icon
              name={clipboard.mode === 'cut' ? 'scissors' : 'copy'}
              size={18}
              color={n.accent300}
            />
            <View style={styles.clipboardBody}>
              <Text style={styles.clipboardLabel}>
                {clipboard.mode === 'cut'
                  ? 'Cut · paste it where it goes'
                  : 'Copied · paste as many copies as you need'}
              </Text>
              <Text style={styles.clipboardText} numberOfLines={1}>
                {summary(clipboard.node)}
              </Text>
            </View>
            <IconButton
              icon="x"
              size="sm"
              color={n.textAlpha(55)}
              onPress={() => setClipboard(null)}
              accessibilityLabel="Clear the clipboard"
            />
          </View>
        ) : null}

        {docked ? (
          <View style={styles.dockedFooter}>
            <Text style={styles.dockedMatch}>
              <Text style={styles.dockedMatchCount}>
                {count == null ? '…' : formatCount(count)}
              </Text>{' '}
              videos match
            </Text>
            {saveLabel && onSave ? (
              <Button label={saveLabel} onPress={onSave} />
            ) : null}
            <Button label="Done" variant="secondary" onPress={onClose} />
          </View>
        ) : null}
        <View style={[styles.footer, docked && styles.hidden]}>
          <Button
            label="Play all"
            variant="secondary"
            size="lg"
            icon="play"
            iconFill
            onPress={() => onPlayAll(wire)}
          />
          <Button
            label={`Show ${count == null ? '…' : formatCount(count)} videos`}
            size="lg"
            grow
            onPress={() => onApply(wire)}
          />
        </View>

        {editing ? (
          <ConditionSheet
            client={client}
            condition={editing.condition}
            onCancel={() => setEditing(null)}
            onSave={(condition) => {
              onChange(
                editing.condition
                  ? replaceNode(tree, editing.condition.id, condition)
                  : appendTo(tree, editing.groupId, condition)
              );
              setEditing(null);
            }}
          />
        ) : null}

        <MenuSheet
          visible={sheet !== null}
          onClose={closeSheet}
          header={
            !sheet ? null : menu && clipboard ? (
              <View style={styles.menuClipboard}>
                <Icon
                  name={clipboard.mode === 'cut' ? 'scissors' : 'copy'}
                  size={14}
                  color={n.accent300}
                />
                <Text style={styles.menuClipboardText} numberOfLines={1}>
                  {clipboard.mode === 'cut' ? 'Cut: ' : 'Copied: '}
                  <Text style={styles.menuClipboardItem}>
                    {summary(clipboard.node)}
                  </Text>
                </Text>
              </View>
            ) : (
              <Text style={styles.menuTitle} numberOfLines={1}>
                {sheet.title}
              </Text>
            )
          }
          items={(sheet?.actions ?? []).map((action) =>
            action === 'rule'
              ? action
              : {
                  icon: action.icon,
                  label: action.label,
                  detail: action.detail,
                  onPress: action.run,
                }
          )}
        />

        <Modal
          visible={levels}
          transparent
          animationType="fade"
          onRequestClose={() => setLevels(false)}
        >
          <Pressable
            style={styles.levelsScrim}
            onPress={() => setLevels(false)}
          >
            <View style={styles.levels}>
              {chain.slice(1, -2).map((g, i) => (
                <Pressable
                  key={g.id}
                  onPress={visited.has(g.id) ? () => goTo(g, false) : undefined}
                  style={({ pressed }) => [
                    styles.level,
                    { paddingLeft: 12 + i * 14 },
                    !visited.has(g.id) && styles.levelSkipped,
                    pressed && styles.menuItemPressed,
                  ]}
                >
                  <Icon
                    name="arrow-elbow-down-right"
                    size={16}
                    color={n.textAlpha(45)}
                  />
                  <View style={styles.menuItemBody}>
                    <Text style={styles.levelName}>{GROUP_LABELS[g.op]}</Text>
                    <Text style={styles.menuDetail} numberOfLines={1}>
                      {runsText(groupPhrase(g))}
                    </Text>
                  </View>
                </Pressable>
              ))}
              <View style={styles.levelsRule} />
              <Text style={styles.levelsHere}>
                Then{' '}
                {chain
                  .slice(-2)
                  .map((g) => GROUP_LABELS[g.op])
                  .join(' › ')}{' '}
                (here)
              </Text>
            </View>
          </Pressable>
        </Modal>
      </View>
    </Raised.Provider>
  );
}

/** Design 5c / 5d: where the open group sits; tap a chip to go there. Deep paths fold their middle into "…". */
function Crumbs({
  chain,
  visited,
  levelsOpen,
  onGo,
  onLevels,
}: {
  chain: Group[];
  visited: Set<string>;
  levelsOpen: boolean;
  onGo: (group: Group) => void;
  onLevels: () => void;
}) {
  const items: (Group | 'fold')[] =
    chain.length > 4 ? [chain[0]!, 'fold', ...chain.slice(-2)] : chain;
  return (
    <View style={styles.crumbs}>
      {items.map((item, i) => {
        const last = i === items.length - 1;
        const sep =
          i > 0 ? (
            <Icon name="caret-right" size={10} color={n.textAlpha(45)} />
          ) : null;
        if (item === 'fold')
          return (
            <View key="fold" style={styles.crumbLine}>
              {sep}
              <Pressable
                onPress={onLevels}
                style={[styles.crumb, levelsOpen && styles.crumbOpen]}
                accessibilityLabel="Hidden levels"
              >
                <Text style={styles.crumbText}>…</Text>
              </Pressable>
            </View>
          );
        const skipped = !visited.has(item.id);
        return (
          <View key={item.id} style={styles.crumbLine}>
            {sep}
            <Pressable
              onPress={last || skipped ? undefined : () => onGo(item)}
              style={styles.crumb}
            >
              {i === 0 ? (
                <Icon
                  name="funnel-simple"
                  size={15}
                  color={last ? n.accent300 : n.textAlpha(55)}
                />
              ) : null}
              <Text
                style={[
                  styles.crumbText,
                  skipped && styles.crumbSkipped,
                  last && styles.crumbHere,
                ]}
                numberOfLines={1}
              >
                {i === 0 ? 'Filter' : GROUP_LABELS[item.op]}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

/** Design 5a: a summary line's pieces; a group token opens that group. */
function Runs({
  runs,
  onOpen,
}: {
  runs: SummaryRun[];
  onOpen?: (group: Group) => void;
}) {
  return runs.map((run, i) => {
    switch (run.kind) {
      case 'lead':
        return (
          <Text key={i} style={styles.summaryLead}>
            {run.text}
          </Text>
        );
      case 'word':
        return (
          <Text key={i} style={styles.summaryWord}>
            {run.text}
          </Text>
        );
      case 'text':
        return <Text key={i}>{run.text}</Text>;
      case 'more':
        return (
          <Text key={i} style={styles.summaryMore}>
            + {run.count} more
          </Text>
        );
      case 'group':
        return (
          <Text
            key={i}
            style={styles.token}
            onPress={onOpen ? () => onOpen(run.group) : undefined}
          >
            {' '}
            <Icon name="brackets-curly" size={11} color={n.accent200} />
            {` ${run.text} `}
            <Icon name="caret-right" size={8} color={n.accent200} />
            {' '}
          </Text>
        );
    }
  });
}

/** A group one level down: its pill (tap cycles) and ⋮, then its children; groups inside it are rows that open. */
function Subgroup({
  group,
  cutId,
  cameFrom,
  clipboard,
  onCycle,
  onEdit,
  onMenu,
  onOpen,
  onAdd,
  onPaste,
}: {
  group: Group;
  cutId: string | null;
  cameFrom: string | null;
  clipboard: Clipboard | null;
  onCycle: (group: Group) => void;
  onEdit: (groupId: string, condition?: Condition) => void;
  onMenu: (node: Node) => void;
  onOpen: (group: Group) => void;
  onAdd: (group: Group) => void;
  onPaste: (groupId: string) => void;
}) {
  const cut = group.id === cutId;
  return (
    <View
      style={[
        styles.subgroup,
        cut && styles.cutGroup,
        group.id === cameFrom && styles.subgroupRing,
      ]}
    >
      <View style={styles.subRow}>
        <Pressable
          onPress={() => onCycle(group)}
          style={[styles.pill, styles.subPill]}
        >
          <Text style={[styles.pillText, styles.subPillText]}>
            {GROUP_LABELS[group.op]}
          </Text>
          <Icon name="caret-up-down" size={12} color={n.accent200} />
        </Pressable>
        {cut ? <CutTag /> : null}
        <View style={styles.spacer} />
        <MoreButton
          size="sm"
          onPress={() => onMenu(group)}
          accessibilityLabel="Group menu"
        />
      </View>
      <View style={styles.children}>
        <View style={[styles.guide, styles.guideSub]} />
        {group.children.map((child) =>
          child.kind === 'condition' ? (
            <ConditionRow
              key={child.id}
              condition={child}
              cut={child.id === cutId}
              onPress={() => onEdit(group.id, child)}
              onMenu={() => onMenu(child)}
            />
          ) : (
            <GroupRow
              key={child.id}
              group={child}
              cut={child.id === cutId}
              ring={child.id === cameFrom}
              onPress={() => onOpen(child)}
              onMenu={() => onMenu(child)}
            />
          )
        )}
        <AddRow
          group={group}
          compact
          clipboard={clipboard}
          onAdd={onAdd}
          onPaste={onPaste}
        />
      </View>
    </View>
  );
}

// Rows in the tablet's drawer (on the surface) sit a step lighter than on the phone's ground: text 6% over the surface
const RAISED = '#2f313d';
const Raised = createContext(false);

/** Design 5b: a group two levels down, as one row: operator, count and its short summary. Tap opens it. */
function GroupRow({
  group,
  cut,
  ring,
  onPress,
  onMenu,
}: {
  group: Group;
  cut?: boolean;
  ring?: boolean;
  onPress: () => void;
  onMenu: () => void;
}) {
  const raised = useContext(Raised);
  const inside = conditionCount(group);
  const phrase = groupPhrase(group);
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.row,
        raised && styles.rowRaised,
        styles.groupRow,
        ring && styles.ringRow,
        cut && styles.cutRow,
      ]}
    >
      <View style={styles.groupTile}>
        <Icon name="brackets-curly" size={16} color={n.accent300} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowLabelLine}>
          <Text style={styles.rowLabel}>
            <Text style={styles.groupRowOp}>{GROUP_LABELS[group.op]}</Text> ·{' '}
            {inside} condition{inside === 1 ? '' : 's'}
          </Text>
          {cut ? <CutTag /> : null}
        </View>
        <Text style={styles.groupRowText} numberOfLines={2}>
          {phrase.length ? <Runs runs={phrase} /> : 'Empty · tap to add to it'}
        </Text>
      </View>
      <Icon name="caret-right" size={14} color={n.textAlpha(55)} />
      <MoreButton size="sm" onPress={onMenu} accessibilityLabel="Menu" />
    </Pressable>
  );
}

/** Design 5e: one "+ Add" per group (Condition / Subgroup / Paste in a sheet); Paste stays beside it as a shortcut. */
function AddRow({
  group,
  compact,
  clipboard,
  onAdd,
  onPaste,
}: {
  group: Group;
  compact?: boolean;
  clipboard: Clipboard | null;
  onAdd: (group: Group) => void;
  onPaste: (groupId: string) => void;
}) {
  return (
    <View style={compact ? styles.subActions : styles.actions}>
      <Button
        label="Add"
        variant="text"
        size="sm"
        icon="plus"
        onPress={() => onAdd(group)}
      />
      {canPaste(clipboard, group.id) ? (
        <PasteButton compact={compact} onPress={() => onPaste(group.id)} />
      ) : null}
    </View>
  );
}

/** Design 4b: where the clipboard goes, in a group's add row. */
function PasteButton({
  onPress,
  compact,
}: {
  onPress: () => void;
  compact?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        compact && styles.subAction,
        styles.paste,
        pressed && styles.actionPressed,
      ]}
    >
      <Icon name="clipboard-text" size={14} color={n.accent200} />
      <Text style={[styles.actionText, styles.pasteText]}>Paste</Text>
    </Pressable>
  );
}

function CutTag() {
  return (
    <View style={styles.cutTag}>
      <Icon name="scissors" size={10} color={n.neutral300} />
      <Text style={styles.cutTagText}>Cut</Text>
    </View>
  );
}

function ConditionRow({
  condition,
  cut,
  onPress,
  onMenu,
}: {
  condition: Condition;
  cut?: boolean;
  onPress: () => void;
  onMenu: () => void;
}) {
  const raised = useContext(Raised);
  const { label, runs, resolved, resolvedMono } = rowText(condition);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, raised && styles.rowRaised, cut && styles.cutRow]}
    >
      <View style={styles.rowBody}>
        <View style={styles.rowLabelLine}>
          <Text style={styles.rowLabel}>{label}</Text>
          {cut ? <CutTag /> : null}
        </View>
        <Text style={styles.rowValue} numberOfLines={1}>
          {runs.map((run, i) =>
            run.folder ? (
              <Icon key={i} name="folder" fill size={14} color={n.accent} />
            ) : run.sep ? (
              <Icon
                key={i}
                name="caret-right"
                size={10}
                color={n.textAlpha(45)}
              />
            ) : (
              <Text
                key={i}
                style={[
                  run.muted && styles.rowMuted,
                  run.mono && styles.rowMono,
                ]}
              >
                {run.text}
              </Text>
            )
          )}
        </Text>
        {resolved ? (
          <Text
            style={[styles.rowResolved, resolvedMono && styles.rowResolvedMono]}
            numberOfLines={1}
            ellipsizeMode="head"
          >
            {resolved}
          </Text>
        ) : null}
      </View>
      <MoreButton size="sm" onPress={onMenu} accessibilityLabel="Menu" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    position: 'absolute',
    left: 0,
    right: 0,
    // App pads its content clear of the system bars; the phone screen reaches under them (by the insets), as in the
    // design
    backgroundColor: n.bg,
  },
  // Docked (tablet, 2d): fills its drawer, on the drawer's surface
  docked: { flex: 1 },
  dockedFooter: {
    paddingTop: 12,
    paddingBottom: 14,
    paddingLeft: 20,
    paddingRight: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: n.divider,
  },
  dockedMatch: {
    flex: 1,
    color: n.textAlpha(60),
    fontSize: 13,
    fontFamily: fonts.regular,
    fontVariant: ['tabular-nums'],
  },
  dockedMatchCount: { color: n.text, fontFamily: fonts.medium },
  dockedSaved: {
    paddingLeft: 20,
    paddingRight: 20,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dockedSavedName: {
    flexShrink: 1,
    color: n.textAlpha(75),
    fontSize: 13,
    fontFamily: fonts.regular,
  },
  // In the drawer the ground is the surface: rows sit a step lighter
  rowRaised: { backgroundColor: RAISED },
  hidden: { display: 'none' },
  header: {
    paddingTop: 4,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  titleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  title: {
    fontFamily: fonts.medium,
    fontSize: 17,
    color: n.text,
    flexShrink: 1,
  },
  headerSave: { marginRight: 4 },
  crumbs: {
    paddingLeft: 10,
    paddingRight: 12,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  crumbLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexShrink: 1,
  },
  crumb: {
    height: 32,
    paddingHorizontal: 8,
    borderRadius: n.radiusMd,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  crumbOpen: { backgroundColor: n.textAlpha(10) },
  crumbText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: n.textAlpha(55),
  },
  crumbHere: { color: n.accent300 },
  crumbSkipped: { color: n.textAlpha(35) },
  body: { flex: 1 },
  bodyContent: { paddingTop: 8, paddingHorizontal: 16, paddingBottom: 20 },
  summary: { marginHorizontal: 4, marginBottom: 16 },
  summaryLine: {
    fontFamily: fonts.regular,
    fontSize: 13.5,
    lineHeight: 13.5 * 1.6,
    color: n.textAlpha(72),
  },
  summaryLead: { fontFamily: fonts.medium, color: n.text },
  summaryWord: { color: n.textAlpha(50) },
  summaryMore: { color: n.accent300 },
  token: {
    fontSize: 12,
    color: n.accent200,
    backgroundColor: n.accentAlpha(14),
  },
  rootRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: n.radiusMd,
    borderWidth: 1,
    borderColor: n.accent,
  },
  rootPill: {
    height: 34,
    paddingHorizontal: 12,
    boxShadow: `0 0 12px ${n.accentAlpha(25)}`,
  },
  subPill: { height: 30, paddingHorizontal: 10 },
  pillText: { fontFamily: fonts.medium, color: n.accent200 },
  rootPillText: { fontSize: 13 },
  subPillText: { fontSize: 12.5 },
  these: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 12,
    color: n.textAlpha(50),
  },
  spacer: { flex: 1 },
  subgroup: { gap: 6, borderRadius: n.radiusMd },
  subgroupRing: { backgroundColor: n.accentAlpha(9) },
  cutGroup: { opacity: 0.6 },
  subActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  paste: { borderWidth: 1, borderColor: n.accentAlpha(45) },
  pasteText: { color: n.accent200 },
  cutTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 5,
    backgroundColor: n.neutral800,
  },
  cutTagText: {
    fontFamily: fonts.regular,
    fontSize: 10.5,
    color: n.neutral300,
  },
  cutRow: {
    opacity: 0.6,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: n.textAlpha(30),
  },
  rowLabelLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  groupRow: { paddingLeft: 10, paddingRight: 8 },
  ringRow: {
    borderWidth: 1,
    borderColor: n.accent,
    boxShadow: `0 0 24px ${n.accentAlpha(22)}`,
  },
  groupTile: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: n.accentAlpha(14),
  },
  groupRowOp: { fontFamily: fonts.medium, color: n.accent200 },
  groupRowText: {
    marginTop: 1,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 13 * 1.45,
    color: n.text,
  },
  clipboardBar: {
    marginHorizontal: 16,
    marginBottom: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: n.radiusMd,
    backgroundColor: n.surface,
    borderWidth: 1,
    borderColor: n.accentAlpha(45),
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  clipboardBody: { flex: 1, minWidth: 0, gap: 1 },
  clipboardLabel: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: n.textAlpha(55),
  },
  clipboardText: { fontFamily: fonts.regular, fontSize: 14, color: n.text },
  menuTitle: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 6,
    fontFamily: fonts.regular,
    fontSize: 12,
    color: n.textAlpha(55),
  },
  menuClipboard: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: n.radiusMd,
    backgroundColor: n.textAlpha(5),
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  menuClipboardText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 12,
    color: n.textAlpha(55),
  },
  menuClipboardItem: { color: n.text },
  menuItemBody: { flex: 1, gap: 2 },
  menuDetail: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: n.textAlpha(55),
  },
  levelsScrim: { flex: 1, backgroundColor: 'rgba(41,43,49,0.4)' },
  levels: {
    position: 'absolute',
    top: 84,
    left: 56,
    right: 16,
    padding: 6,
    borderRadius: n.radiusMd,
    backgroundColor: n.surface,
    borderWidth: 1,
    borderColor: n.divider,
    boxShadow: '0 20px 40px rgba(0,0,0,0.45)',
  },
  level: {
    minHeight: 56,
    paddingVertical: 6,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: n.radiusMd,
  },
  levelSkipped: { opacity: 0.5 },
  levelName: { fontFamily: fonts.medium, fontSize: 14, color: n.text },
  levelsRule: {
    marginVertical: 4,
    marginHorizontal: 12,
    height: 1,
    backgroundColor: n.divider,
  },
  levelsHere: {
    paddingTop: 6,
    paddingHorizontal: 12,
    paddingBottom: 8,
    fontFamily: fonts.regular,
    fontSize: 12,
    color: n.textAlpha(50),
  },
  children: { position: 'relative', paddingLeft: 16, gap: 6 },
  guide: {
    position: 'absolute',
    left: 5,
    top: 0,
    width: 1,
    backgroundColor: n.divider,
  },
  guideRoot: { bottom: 22 },
  guideSub: { bottom: 20 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  row: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: n.radiusMd,
    backgroundColor: n.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowBody: { flex: 1 },
  rowLabel: {
    fontFamily: fonts.regular,
    fontSize: 11.5,
    color: n.textAlpha(50),
  },
  rowValue: { fontFamily: fonts.regular, fontSize: 14, color: n.text },
  rowMuted: { color: n.textAlpha(55) },
  rowMono: { fontFamily: fonts.mono, fontSize: 13 },
  rowResolvedMono: { fontFamily: fonts.mono, fontSize: 11.5 },
  rowResolved: {
    fontFamily: fonts.regular,
    fontSize: 11.5,
    color: n.accent300,
  },
  actions: { flexDirection: 'row', gap: 6, marginTop: 6 },
  action: {
    height: 36,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: n.radiusMd,
    alignSelf: 'flex-start',
  },
  subAction: { height: 34, paddingHorizontal: 10 },
  actionPressed: { backgroundColor: n.accentAlpha(10) },
  actionText: { fontFamily: fonts.regular, fontSize: 13, color: n.accent300 },
  footer: {
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'android' ? 12 : 30,
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: n.divider,
    backgroundColor: n.bg,
  },
  menuItemPressed: { backgroundColor: n.accentAlpha(10) },
});
