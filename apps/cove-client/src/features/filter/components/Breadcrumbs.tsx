import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../../ui/Icon';
import { GROUP_LABELS, type Group } from '../model';
import { fonts, nocturne as n } from '../../../theme/tokens';

/** Design 5c / 5d: where the open group sits; tap a chip to go there. Deep paths fold their middle into "…". */
export function Breadcrumbs({
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

const styles = StyleSheet.create({
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
  crumbSkipped: { color: n.textAlpha(35) },
  crumbHere: { color: n.accent300 },
});
