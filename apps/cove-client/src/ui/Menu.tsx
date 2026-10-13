import type { ReactNode } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fonts, nocturne as n, raisedEdge, shadows } from '../theme/tokens';
import { Icon, type IconName } from './Icon';
import { Sheet, SheetRow, SheetRule } from './Sheet';
import { SmoothEdges } from '../platform/SmoothEdges';

/** A menu's entry, or 'rule' (a fading rule, before the destructive ones). `selected`: the one in effect (a choice). */
export type MenuEntry =
  | {
      icon: IconName;
      label: string;
      detail?: string;
      selected?: boolean;
      onPress: () => void;
    }
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
// The modal spans the screen under the status bar (statusBarTranslucent), the window (not edge to edge) starts below
// it: window coordinates are that much higher in the modal.
const WINDOW_TOP =
  Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;

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
      <SmoothEdges />
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityLabel="Close"
      />
      {anchor ? (
        <View
          style={[
            styles.popover,
            { top: WINDOW_TOP + anchor.y + 4, left: anchor.x - POPOVER_WIDTH },
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
                accessibilityState={
                  item.selected != null
                    ? { selected: item.selected }
                    : undefined
                }
                style={({ pressed }) => [
                  styles.item,
                  pressed && styles.pressed,
                ]}
              >
                <Icon name={item.icon} size={18} color={n.accent300} />
                <Text
                  style={[
                    styles.itemText,
                    item.selected && styles.itemSelected,
                  ]}
                  numberOfLines={1}
                >
                  {item.label}
                </Text>
                {item.selected ? (
                  <Icon name="check" size={16} color={n.accent} />
                ) : null}
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
    ...raisedEdge(n.textAlpha(10), shadows.lg),
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
  itemText: {
    flex: 1,
    color: n.text,
    fontSize: 15,
    fontFamily: fonts.regular,
  },
  itemSelected: { color: n.accent200, fontFamily: fonts.medium },
  rule: { height: 1, marginVertical: 4, backgroundColor: n.divider },
});
