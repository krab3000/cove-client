import { useContext } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../../ui/Button';
import { Icon } from '../../../ui/Icon';
import { MoreButton } from '../../../ui/IconButton';
import {
  GROUP_LABELS,
  canPaste,
  conditionCount,
  groupPhrase,
  rowText,
  type Clipboard,
  type Condition,
  type Group,
  type Node,
  type SummaryRun,
} from '../model';
import { fonts, nocturne as n } from '../../../theme/tokens';
import { Raised } from '../raised';

/** Design 5a: a summary line's pieces; a group token opens that group. */
export function Runs({
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
export function Subgroup({
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

/** Design 5b: a group two levels down, as one row: operator, count and its short summary. Tap opens it. */
export function GroupRow({
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
export function AddRow({
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
export function PasteButton({
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

export function CutTag() {
  return (
    <View style={styles.cutTag}>
      <Icon name="scissors" size={10} color={n.neutral300} />
      <Text style={styles.cutTagText}>Cut</Text>
    </View>
  );
}

export function ConditionRow({
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
  summaryLead: { fontFamily: fonts.medium, color: n.text },
  summaryWord: { color: n.textAlpha(50) },
  summaryMore: { color: n.accent300 },
  token: {
    fontSize: 12,
    color: n.accent200,
    backgroundColor: n.accentAlpha(14),
  },
  subgroup: { gap: 6, borderRadius: n.radiusMd },
  cutGroup: { opacity: 0.6 },
  subgroupRing: { backgroundColor: n.accentAlpha(9) },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: n.radiusMd,
    borderWidth: 1,
    borderColor: n.accent,
  },
  subPill: { height: 30, paddingHorizontal: 10 },
  pillText: { fontFamily: fonts.medium, color: n.accent200 },
  subPillText: { fontSize: 12.5 },
  spacer: { flex: 1 },
  children: { position: 'relative', paddingLeft: 16, gap: 6 },
  guide: {
    position: 'absolute',
    left: 5,
    top: 0,
    width: 1,
    backgroundColor: n.divider,
  },
  guideSub: { bottom: 20 },
  row: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: n.radiusMd,
    backgroundColor: n.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  // In the drawer the ground is the surface: rows sit a step lighter
  rowRaised: { backgroundColor: n.raised },
  groupRow: { paddingLeft: 10, paddingRight: 8 },
  ringRow: {
    borderWidth: 1,
    borderColor: n.accent,
    boxShadow: `0 0 24px ${n.accentAlpha(22)}`,
  },
  cutRow: {
    opacity: 0.6,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: n.textAlpha(30),
  },
  groupTile: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: n.accentAlpha(14),
  },
  rowBody: { flex: 1 },
  rowLabelLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowLabel: {
    fontFamily: fonts.regular,
    fontSize: 11.5,
    color: n.textAlpha(50),
  },
  groupRowOp: { fontFamily: fonts.medium, color: n.accent200 },
  groupRowText: {
    marginTop: 1,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 13 * 1.45,
    color: n.text,
  },
  subActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
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
  paste: { borderWidth: 1, borderColor: n.accentAlpha(45) },
  actionPressed: { backgroundColor: n.accentAlpha(10) },
  actionText: { fontFamily: fonts.regular, fontSize: 13, color: n.accent300 },
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
  rowValue: { fontFamily: fonts.regular, fontSize: 14, color: n.text },
  rowMuted: { color: n.textAlpha(55) },
  rowMono: { fontFamily: fonts.mono, fontSize: 13 },
  rowResolved: {
    fontFamily: fonts.regular,
    fontSize: 11.5,
    color: n.accent300,
  },
  rowResolvedMono: { fontFamily: fonts.mono, fontSize: 11.5 },
});
