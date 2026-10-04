import { useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
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
import { Icon } from '../components/Icon';
import {
  GROUP_LABELS,
  appendTo,
  describe,
  newId,
  nextOp,
  replaceNode,
  rowText,
  toWire,
  type Condition,
  type Group,
  type Node,
} from '../filter/model';
import { fonts, nocturne as n } from '../filter/theme';

/**
 * Design 2b (design_handoff_cove_mobile, "Rule tree as an outline"), for phones: a Cove filter as an outline of
 * groups and conditions, with the whole tree as a sentence on top and the live result count in the footer. Tapping a
 * group's pill cycles All / Any / Just one / None. Nesting is indentation with a guide line, not boxes in boxes.
 */
export function FilterScreen({
  client,
  tree,
  onChange,
  applied,
  onApply,
  onPlayAll,
  onClose,
}: {
  client: CoveClient;
  tree: Group;
  onChange: (tree: Group) => void;
  /** The filter the main screen shows now */
  applied: FilterExpression | null;
  onApply: (filter: FilterExpression | null) => void;
  onPlayAll: (filter: FilterExpression | null) => void;
  onClose: () => void;
}) {
  const wire = useMemo(() => toWire(tree), [tree]);
  const wireJson = JSON.stringify(wire);
  const edited = wireJson !== JSON.stringify(applied ?? null);
  const [count, setCount] = useState<number | null>(null);
  const [editing, setEditing] = useState<{
    groupId: string;
    condition?: Condition;
  } | null>(null);
  const [menu, setMenu] = useState<Node | null>(null);

  // The live count, once the tree has settled for a moment.
  useEffect(() => {
    let current = true;
    setCount(null);
    const timer = setTimeout(() => {
      client.countVideos(JSON.parse(wireJson)).then(
        (c) => current && setCount(c),
        () => {}
      );
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [client, wireJson]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (editing) setEditing(null);
      else if (menu) setMenu(null);
      else onClose();
      return true;
    });
    return () => sub.remove();
  }, [editing, menu, onClose]);

  const cycle = (group: Group) =>
    onChange(replaceNode(tree, group.id, { ...group, op: nextOp(group.op) }));
  const addSubgroup = () =>
    onChange(
      appendTo(tree, tree.id, {
        kind: 'group',
        id: newId(),
        op: 'any',
        children: [],
      })
    );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={onClose} style={styles.back} hitSlop={4}>
          <Icon name="caret-left" size={20} color={n.text} />
        </Pressable>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            New filter
          </Text>
          {edited && tree.children.length ? (
            <Text style={styles.edited}>Edited</Text>
          ) : null}
        </View>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
      >
        <Text style={styles.summary}>{describe(tree)}</Text>
        <View style={styles.rootRow}>
          <Pressable
            onPress={() => cycle(tree)}
            style={[styles.pill, styles.rootPill]}
          >
            <Text style={[styles.pillText, styles.rootPillText]}>
              {GROUP_LABELS[tree.op]}
            </Text>
            <Icon name="caret-up-down" size={13} color={n.accent200} />
          </Pressable>
          <Text style={styles.these}>
            {tree.children.length === 1
              ? 'this 1'
              : `these ${tree.children.length}`}
          </Text>
        </View>
        <View style={styles.children}>
          <View style={[styles.guide, styles.guideRoot]} />
          {tree.children.map((child) =>
            child.kind === 'condition' ? (
              <ConditionRow
                key={child.id}
                condition={child}
                onPress={() =>
                  setEditing({ groupId: tree.id, condition: child })
                }
                onMenu={() => setMenu(child)}
              />
            ) : (
              <Subgroup
                key={child.id}
                group={child}
                onCycle={cycle}
                onEdit={(groupId, condition) =>
                  setEditing({ groupId, condition })
                }
                onMenu={setMenu}
              />
            )
          )}
          <View style={styles.actions}>
            <Pressable
              onPress={() => setEditing({ groupId: tree.id })}
              style={({ pressed }) => [
                styles.action,
                pressed && styles.actionPressed,
              ]}
            >
              <Icon name="plus" size={14} color={n.accent300} />
              <Text style={styles.actionText}>Condition</Text>
            </Pressable>
            <Pressable
              onPress={addSubgroup}
              style={({ pressed }) => [
                styles.action,
                pressed && styles.actionPressed,
              ]}
            >
              <Icon name="brackets-curly" size={14} color={n.accent300} />
              <Text style={styles.actionText}>Subgroup</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          onPress={() => onPlayAll(wire)}
          style={({ pressed }) => [
            styles.secondary,
            pressed && styles.secondaryPressed,
          ]}
        >
          <Icon name="play" fill size={14} color={n.text} />
          <Text style={styles.secondaryText}>Play all</Text>
        </Pressable>
        <Pressable
          onPress={() => onApply(wire)}
          style={({ pressed }) => [
            styles.primary,
            pressed && styles.primaryPressed,
          ]}
        >
          <Text style={styles.primaryText}>
            Show {count == null ? '…' : count.toLocaleString('en-US')} videos
          </Text>
        </Pressable>
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

      <Modal
        visible={menu !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setMenu(null)}
      >
        <Pressable style={styles.menuScrim} onPress={() => setMenu(null)}>
          <View style={styles.menu}>
            {menu?.kind === 'condition' ? (
              <MenuItem
                icon="pencil-simple"
                label="Edit condition"
                onPress={() => {
                  const condition = menu;
                  setMenu(null);
                  setEditing({ groupId: tree.id, condition });
                }}
              />
            ) : null}
            <MenuItem
              icon="trash"
              label={
                menu?.kind === 'group' ? 'Remove subgroup' : 'Remove condition'
              }
              onPress={() => {
                if (menu) onChange(replaceNode(tree, menu.id, null));
                setMenu(null);
              }}
            />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

/** A nested group: its pill (tap cycles, long-press for its menu), then its children, indented with a guide. */
function Subgroup({
  group,
  onCycle,
  onEdit,
  onMenu,
}: {
  group: Group;
  onCycle: (group: Group) => void;
  onEdit: (groupId: string, condition?: Condition) => void;
  onMenu: (node: Node) => void;
}) {
  return (
    <>
      <View style={styles.subRow}>
        <Pressable
          onPress={() => onCycle(group)}
          onLongPress={() => onMenu(group)}
          style={[styles.pill, styles.subPill]}
        >
          <Text style={[styles.pillText, styles.subPillText]}>
            {GROUP_LABELS[group.op]}
          </Text>
          <Icon name="caret-up-down" size={12} color={n.accent200} />
        </Pressable>
      </View>
      <View style={styles.children}>
        <View style={[styles.guide, styles.guideSub]} />
        {group.children.map((child) =>
          child.kind === 'condition' ? (
            <ConditionRow
              key={child.id}
              condition={child}
              onPress={() => onEdit(group.id, child)}
              onMenu={() => onMenu(child)}
            />
          ) : (
            <Subgroup
              key={child.id}
              group={child}
              onCycle={onCycle}
              onEdit={onEdit}
              onMenu={onMenu}
            />
          )
        )}
        <Pressable
          onPress={() => onEdit(group.id)}
          style={({ pressed }) => [
            styles.action,
            styles.subAction,
            pressed && styles.actionPressed,
          ]}
        >
          <Icon name="plus" size={14} color={n.accent300} />
          <Text style={styles.actionText}>Condition</Text>
        </Pressable>
      </View>
    </>
  );
}

function ConditionRow({
  condition,
  onPress,
  onMenu,
}: {
  condition: Condition;
  onPress: () => void;
  onMenu: () => void;
}) {
  const { label, runs, resolved, resolvedMono } = rowText(condition);
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
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
      <Pressable onPress={onMenu} hitSlop={12} style={styles.rowMenu}>
        <Icon name="dots-three-vertical" size={16} color={n.textAlpha(45)} />
      </Pressable>
    </Pressable>
  );
}

function MenuItem({
  icon,
  label,
  onPress,
}: {
  icon: 'pencil-simple' | 'trash';
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuItem,
        pressed && styles.menuItemPressed,
      ]}
    >
      <Icon name={icon} size={18} color={n.accent300} />
      <Text style={styles.menuText}>{label}</Text>
    </Pressable>
  );
}

// App pads its content clear of Android's system bars (App.tsx); the screen reaches under them, as in the design.
const INSET_TOP = Platform.OS === 'android' ? 36 : 0;
const INSET_BOTTOM = Platform.OS === 'android' ? 48 : 0;

const styles = StyleSheet.create({
  screen: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -INSET_TOP,
    bottom: -INSET_BOTTOM,
    paddingTop: INSET_TOP,
    paddingBottom: INSET_BOTTOM,
    backgroundColor: n.bg,
  },
  header: {
    paddingTop: 4,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
  edited: {
    fontFamily: fonts.regular,
    fontSize: 11,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: n.accent800,
    color: n.accent100,
  },
  body: { flex: 1 },
  bodyContent: { paddingTop: 8, paddingHorizontal: 16, paddingBottom: 20 },
  summary: {
    marginHorizontal: 4,
    marginBottom: 16,
    fontFamily: fonts.regular,
    fontSize: 13.5,
    lineHeight: 13.5 * 1.55,
    color: n.textAlpha(72),
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
  these: { fontFamily: fonts.regular, fontSize: 12, color: n.textAlpha(50) },
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
  rowMenu: { paddingVertical: 4 },
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
    paddingBottom: 30 - (INSET_BOTTOM ? 18 : 0),
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: n.divider,
    backgroundColor: n.bg,
  },
  secondary: {
    height: 50,
    paddingHorizontal: 16,
    borderRadius: n.radiusMd,
    borderWidth: 1,
    borderColor: n.divider,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  secondaryPressed: { backgroundColor: n.textAlpha(7) },
  secondaryText: { fontFamily: fonts.medium, fontSize: 14, color: n.text },
  primary: {
    flex: 1,
    height: 50,
    borderRadius: n.radiusMd,
    borderWidth: 1,
    borderColor: n.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryPressed: { backgroundColor: n.accentAlpha(12) },
  primaryText: { fontFamily: fonts.medium, fontSize: 15, color: n.accent200 },
  menuScrim: { flex: 1, backgroundColor: n.scrim, justifyContent: 'flex-end' },
  menu: {
    backgroundColor: n.surface,
    borderTopLeftRadius: n.radiusSheet,
    borderTopRightRadius: n.radiusSheet,
    paddingTop: 12,
    paddingBottom: 12 + INSET_BOTTOM,
    paddingHorizontal: 12,
  },
  menuItem: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    borderRadius: n.radiusMd,
  },
  menuItemPressed: { backgroundColor: n.accentAlpha(10) },
  menuText: { fontFamily: fonts.regular, fontSize: 15, color: n.text },
});
