import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts, nocturne as n, shadows } from '../theme/tokens';
import { Icon, type IconName } from './Icon';
import { Sheet, SheetRow, SheetRule } from './Sheet';

/** A menu's entry, or 'rule' (a fading rule, before the destructive ones). */
export type MenuEntry =
  | { icon: IconName; label: string; detail?: string; onPress: () => void }
  | 'rule';

/**
 * A menu as a bottom sheet (the filter editor's, design 4a): a caption saying what it is about (or any header), then
 * its entries. An entry closes the menu, then runs.
 */
export function MenuSheet({
  visible,
  onClose,
  caption,
  header,
  items,
}: {
  visible: boolean;
  onClose: () => void;
  caption?: string;
  header?: ReactNode;
  items: MenuEntry[];
}) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      {header ??
        (caption ? (
          <Text style={styles.caption} numberOfLines={1}>
            {caption}
          </Text>
        ) : null)}
      {items.map((item, i) =>
        item === 'rule' ? (
          <SheetRule key={`rule${i}`} />
        ) : (
          <SheetRow
            key={item.label}
            icon={item.icon}
            label={item.label}
            meta={item.detail}
            onPress={() => {
              onClose();
              item.onPress();
            }}
          />
        )
      )}
    </Sheet>
  );
}

const POPOVER_WIDTH = 220;

/**
 * A menu by what opened it (a tablet's ⋮): its entries in a small card under the anchor, right-aligned to it (window
 * coordinates). A tap beside it closes it.
 */
export function Popover({
  visible,
  anchor,
  onClose,
  items,
}: {
  visible: boolean;
  // The opener's bottom-right corner, in window coordinates
  anchor: { x: number; y: number } | null;
  onClose: () => void;
  items: MenuEntry[];
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityLabel="Close"
      />
      {anchor ? (
        <View
          style={[
            styles.popover,
            { top: anchor.y + 4, left: anchor.x - POPOVER_WIDTH },
          ]}
        >
          {items.map((item, i) =>
            item === 'rule' ? (
              <View key={`rule${i}`} style={styles.rule} />
            ) : (
              <Pressable
                key={item.label}
                onPress={() => {
                  onClose();
                  item.onPress();
                }}
                style={({ pressed }) => [
                  styles.item,
                  pressed && styles.pressed,
                ]}
              >
                <Icon name={item.icon} size={18} color={n.accent300} />
                <Text style={styles.itemText} numberOfLines={1}>
                  {item.label}
                </Text>
              </Pressable>
            )
          )}
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  caption: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 6,
    color: n.textAlpha(55),
    fontSize: 12,
    fontFamily: fonts.regular,
  },
  popover: {
    position: 'absolute',
    width: POPOVER_WIDTH,
    padding: 6,
    borderRadius: n.radiusPopover,
    backgroundColor: n.surface,
    boxShadow: `inset 0 0 0 1px ${n.textAlpha(10)}, ${shadows.lg}`,
  },
  item: {
    height: 44,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: n.radiusMd,
  },
  pressed: { backgroundColor: n.textAlpha(6) },
  itemText: { color: n.text, fontSize: 15, fontFamily: fonts.regular },
  rule: { height: 1, marginVertical: 4, backgroundColor: n.divider },
});
