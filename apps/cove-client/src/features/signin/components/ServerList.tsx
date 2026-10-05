import { useRef, type ComponentRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../../ui/Button';
import { Icon } from '../../../ui/Icon';
import { MoreButton } from '../../../ui/IconButton';
import { StatusDot } from '../../../ui/Text';
import { fonts, nocturne as n } from '../../../theme/tokens';
import { type KeptServer, type SignIn } from '../../../signIn';
import { ago } from '../../../lib/format';

// --- 1a: the servers ---------------------------------------------------------------------------------------------

export function ServerList({
  state,
  reached,
  selectedId,
  large,
  onPick,
  onMenu,
  onAdd,
}: {
  state: SignIn;
  reached: Record<string, boolean | undefined>;
  // A tablet's selected server (its accounts beside the list)
  selectedId: string | null;
  large: boolean;
  onPick: (id: string) => void;
  onMenu: (server: KeptServer, anchor?: { x: number; y: number }) => void;
  onAdd: () => void;
}) {
  // The ⋮ buttons, so a tablet's popover can open under one
  const mores = useRef(new Map<string, ComponentRef<typeof View>>());
  return (
    <View style={styles.fill}>
      <View style={styles.glow} pointerEvents="none" />
      <ScrollView contentContainerStyle={styles.serversContent}>
        <View style={styles.brand}>
          <View style={styles.brandMark} />
          <Text style={styles.brandText}>Cove</Text>
        </View>
        <Text style={[styles.h1, large && styles.h1Large]}>
          {large ? 'Connect to your library' : 'Connect to\nyour library'}
        </Text>
        <Text style={styles.subtitle}>Your Cove servers</Text>
        <View style={styles.list}>
          {state.servers.map((s) => {
            const online = reached[s.id];
            const signedIn = s.accounts
              .filter((a) => a.refreshToken)
              .map((a) => a.username);
            const status =
              online === false
                ? `Offline${s.lastReached ? ` · last reached ${ago(s.lastReached)}` : ''}`
                : signedIn.length
                  ? `Signed in as ${signedIn.join(', ')}`
                  : s.accounts.length
                    ? 'Password needed'
                    : 'No accounts yet';
            const ringed = large
              ? selectedId === s.id
              : state.last?.serverId === s.id;
            return (
              <View
                key={s.id}
                style={[styles.serverRow, ringed && styles.serverRowOn]}
              >
                <Pressable
                  onPress={() => onPick(s.id)}
                  accessibilityLabel={`${s.name}, ${status}`}
                  accessibilityState={{ selected: ringed }}
                  style={({ pressed }) => [
                    styles.serverMain,
                    online === false && styles.offline,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.serverIcon}>
                    <Icon name="hard-drives" size={22} color={n.accent300} />
                  </View>
                  <View style={styles.serverText}>
                    <Text style={styles.serverName} numberOfLines={1}>
                      {s.name}
                    </Text>
                    <Text style={styles.serverMeta} numberOfLines={1}>
                      {s.address}
                    </Text>
                    <View style={styles.statusLine}>
                      <StatusDot on={online !== false} />
                      <Text style={styles.serverMeta} numberOfLines={1}>
                        {status}
                      </Text>
                    </View>
                  </View>
                  {large ? null : (
                    <Icon
                      name="caret-right"
                      size={16}
                      color={n.textAlpha(40)}
                    />
                  )}
                </Pressable>
                <MoreButton
                  ref={(v) => {
                    if (v) mores.current.set(s.id, v);
                    else mores.current.delete(s.id);
                  }}
                  onPress={() => {
                    const button = mores.current.get(s.id);
                    if (!large || !button) onMenu(s);
                    else
                      button.measureInWindow((x, y, w, h) =>
                        onMenu(s, { x: x + w, y: y + h })
                      );
                  }}
                  accessibilityLabel={`${s.name} options`}
                />
              </View>
            );
          })}
          {state.servers.length || large ? null : (
            <Text style={styles.help}>
              Add your Cove server by the address you open it at in a browser.
            </Text>
          )}
          <Button
            label="Add server"
            icon="plus"
            variant="text"
            onPress={onAdd}
            style={styles.add}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  glow: {
    position: 'absolute',
    top: -120,
    left: -80,
    width: 420,
    height: 420,
    borderRadius: 210,
    experimental_backgroundImage: `radial-gradient(circle, ${n.accentAlpha(22)}, transparent 70%)`,
  },
  serversContent: { paddingTop: 28, paddingBottom: 30 },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
  },
  brandMark: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: n.accent,
    boxShadow: `0 0 12px ${n.accentAlpha(60)}`,
  },
  brandText: { color: n.text, fontSize: 17, fontFamily: fonts.medium },
  h1: {
    marginTop: 28,
    marginBottom: 4,
    paddingHorizontal: 24,
    color: n.text,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.6,
    fontFamily: fonts.medium,
  },
  h1Large: { fontSize: 26, lineHeight: 32, letterSpacing: -0.4 },
  subtitle: {
    paddingHorizontal: 24,
    color: n.textAlpha(60),
    fontSize: 14,
    fontFamily: fonts.regular,
  },
  list: { paddingTop: 22, paddingHorizontal: 16, gap: 8 },
  serverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 4,
    borderRadius: n.radiusLg,
    backgroundColor: n.surface,
  },
  serverRowOn: {
    borderWidth: 1,
    borderColor: n.accent,
    boxShadow: `0 0 24px ${n.accentAlpha(22)}`,
  },
  serverMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 8,
    borderRadius: n.radiusMd,
  },
  offline: { opacity: 0.55 },
  pressed: { backgroundColor: n.textAlpha(6) },
  serverIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: n.accentAlpha(14),
  },
  serverText: { flex: 1, minWidth: 0, gap: 2 },
  serverName: { color: n.text, fontSize: 15, fontFamily: fonts.medium },
  serverMeta: {
    flexShrink: 1,
    color: n.textAlpha(55),
    fontSize: 12,
    fontFamily: fonts.regular,
  },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  help: {
    marginHorizontal: 6,
    marginTop: 4,
    color: n.textAlpha(60),
    fontSize: 13.5,
    lineHeight: 21,
    fontFamily: fonts.regular,
  },
  add: { alignSelf: 'flex-start' },
});
