import { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { CoveClient } from '../../api/cove';
import { Drawer } from '../../ui/Drawer';
import { Button } from '../../ui/Button';
import { Sheet } from '../../ui/Sheet';
import { fonts, nocturne as n } from '../../theme/tokens';
import {
  hostOf,
  newServerId,
  normalizeAddress,
  withServer,
  type KeptServer,
  type SignIn,
} from '../../state/signIn';
import { isLarge } from '../../theme/layout';
import { MenuSheet, Popover, type MenuEntry } from '../../ui/Menu';
import { Layer, useBackHandler } from '../../app/back';
import { useAskAgain, useReachability } from '../../data/library';
import { ServerList } from './components/ServerList';
import { ServerForm } from './components/ServerForm';
import { Unreachable } from './components/Unreachable';
import { AccountsPane } from './components/AccountsPane';
import { useSnapshot } from 'valtio';
import { accounts, changeAccounts } from '../../state/accounts';
import { enter, session } from '../../state/session';

// A large screen: the servers list beside the accounts (design 1n)
const LIST_WIDTH = 380;

/**
 * Signing in (design 1a, 1b; on a tablet 1n): the servers you added — an editable list (⋮: Edit, Remove; Add server)
 * — and, for the one picked, the accounts kept on this device. A kept account goes straight in (its session is
 * resumed); a lock means it has no session (signed out, or it ran out), so it asks for the password. Cove has no
 * discovery and lists users only to admins, so both lists are the device's own. A phone shows one list at a time; a
 * tablet both, side by side.
 */
export function SignInScreen() {
  // The servers and accounts kept on this device; changes go to the store (and storage)
  const state = useSnapshot(accounts) as SignIn;
  const onChange = changeAccounts;
  const onSignedIn = enter;
  // Opens on this server's accounts (after signing out of it, or when its session couldn't be resumed)
  const initialServerId = useSnapshot(session).signInServerId;
  const window = useWindowDimensions();
  const large = isLarge(window.width, window.height);
  const [serverId, setServerId] = useState<string | null>(
    initialServerId && state.servers.some((s) => s.id === initialServerId)
      ? initialServerId
      : null
  );
  // A tablet always shows one server's accounts: the one picked, else the last used, else the first
  const server =
    state.servers.find((s) => s.id === serverId) ??
    (large
      ? (state.servers.find((s) => s.id === state.last?.serverId) ??
        state.servers[0] ??
        null)
      : null);

  useBackHandler(
    !!serverId && !large && (() => setServerId(null)),
    Layer.screen
  );

  // Which servers answer (undefined: still asking); asked again on Try again
  const answers = useReachability(state.servers.map((s) => s.address));
  const reached: Record<string, boolean | undefined> = Object.fromEntries(
    state.servers.map((s, i) => [s.id, answers[i]])
  );
  const askAgain = useAskAgain();
  // A server that answered: when it was last reached (the list says so while it is away)
  const answered = state.servers
    .filter((_, i) => answers[i] === true)
    .map((s) => s.id)
    .join(' ');
  useEffect(() => {
    if (!answered) return;
    const now = Date.now();
    const ids = new Set(answered.split(' '));
    onChange((s) => ({
      ...s,
      servers: s.servers.map((x) =>
        ids.has(x.id) ? { ...x, lastReached: now } : x
      ),
    }));
  }, [answered, onChange]);

  // ⋮: the server, and on a tablet where its popover goes
  const [menu, setMenu] = useState<{
    server: KeptServer;
    anchor?: { x: number; y: number };
  } | null>(null);
  // The add / edit form: the server edited, or 'add'
  const [editing, setEditing] = useState<KeptServer | 'add' | null>(null);
  const [draftAddress, setDraftAddress] = useState('');
  const [draftName, setDraftName] = useState('');
  const openEditor = (target: KeptServer | 'add') => {
    setMenu(null);
    setEditing(target);
    setDraftAddress(target === 'add' ? '' : target.address);
    setDraftName(target === 'add' ? '' : target.name);
  };
  const saveServer = () => {
    const address = normalizeAddress(draftAddress);
    if (!address || !editing) return;
    const name = draftName.trim() || hostOf(address);
    if (editing === 'add') {
      const id = newServerId();
      onChange((s) => ({
        ...s,
        servers: [
          ...s.servers,
          { id, name, address, accounts: [], lastReached: null },
        ],
      }));
      // A tablet goes on to the new server's first account
      if (large) setServerId(id);
    } else
      onChange((s) =>
        withServer(s, editing.id, (x) => ({ ...x, name, address }))
      );
    setEditing(null);
  };
  const removeServer = (target: KeptServer) => {
    setMenu(null);
    for (const a of target.accounts)
      if (a.refreshToken) CoveClient.revoke(target.address, a.refreshToken);
    onChange((s) => ({
      servers: s.servers.filter((x) => x.id !== target.id),
      last: s.last?.serverId === target.id ? null : s.last,
    }));
    if (serverId === target.id) setServerId(null);
  };

  // ⋮'s entries (the sheet's and the popover's)
  const menuItems: MenuEntry[] = menu
    ? [
        {
          icon: 'pencil-simple',
          label: 'Edit',
          onPress: () => openEditor(menu.server),
        },
        'rule',
        {
          icon: 'trash',
          label: 'Remove server',
          detail: 'Forgets its address and the accounts kept for it',
          onPress: () => removeServer(menu.server),
        },
      ]
    : [];
  const form = (
    <ServerForm
      title={editing === 'add' ? 'Add server' : 'Edit server'}
      saveLabel={editing === 'add' ? 'Add' : 'Save'}
      address={draftAddress}
      name={draftName}
      onAddress={setDraftAddress}
      onName={setDraftName}
      onCancel={() => setEditing(null)}
      onSave={saveServer}
      drawer={large}
    />
  );
  const list = (
    <ServerList
      state={state}
      reached={reached}
      selectedId={large ? (server?.id ?? null) : null}
      large={large}
      onPick={setServerId}
      onMenu={(s, anchor) => setMenu({ server: s, anchor })}
      onAdd={() => openEditor('add')}
    />
  );

  return (
    <View style={styles.screen}>
      {large ? (
        <View style={styles.panes}>
          <View style={styles.listPane}>{list}</View>
          <View style={styles.accountsPane}>
            {server ? (
              reached[server.id] === false ? (
                <Unreachable
                  server={server}
                  onEdit={() => openEditor(server)}
                  onRetry={askAgain}
                />
              ) : (
                <AccountsPane
                  key={server.id}
                  server={server}
                  large
                  onChange={onChange}
                  onSignedIn={onSignedIn}
                />
              )
            ) : (
              <View style={styles.centered}>
                <Text style={styles.paneTitle}>Add your Cove server</Text>
                <Text style={styles.paneText}>
                  By the address you open it at in a browser.
                </Text>
                <Button
                  label="Add server"
                  onPress={() => openEditor('add')}
                  size="lg"
                  style={styles.paneButton}
                />
              </View>
            )}
          </View>
          {/* Add / edit: a drawer, as the filter's (2d); a tap beside it closes it */}
          {editing ? (
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setEditing(null)}
              accessibilityLabel="Close"
            />
          ) : null}
          <Drawer open={!!editing} onClose={() => setEditing(null)} width={400}>
            {form}
          </Drawer>
        </View>
      ) : server ? (
        <AccountsPane
          key={server.id}
          server={server}
          large={false}
          onChange={onChange}
          onSignedIn={onSignedIn}
          onBack={() => setServerId(null)}
        />
      ) : (
        list
      )}

      {/* ⋮: a sheet on a phone (the filter editor's), a popover by the row on a tablet */}
      {large ? (
        <Popover
          visible={!!menu}
          anchor={menu?.anchor ?? null}
          onClose={() => setMenu(null)}
          items={menuItems}
        />
      ) : (
        <MenuSheet
          visible={!!menu}
          onClose={() => setMenu(null)}
          caption={menu ? `${menu.server.name} · ${menu.server.address}` : ''}
          items={menuItems}
        />
      )}
      {large ? null : (
        <Sheet visible={!!editing} onClose={() => setEditing(null)}>
          {form}
        </Sheet>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: n.bg },
  panes: { flex: 1, flexDirection: 'row' },
  // The list on the sidebar's tint (1h)
  listPane: { width: LIST_WIDTH, backgroundColor: '#1d1f2c' },
  accountsPane: { flex: 1 },
  // A tablet's right pane, for a state with no accounts to show
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 48,
    gap: 10,
  },
  paneTitle: {
    color: n.text,
    fontSize: 24,
    lineHeight: 30,
    textAlign: 'center',
    fontFamily: fonts.medium,
  },
  paneText: {
    maxWidth: 420,
    color: n.textAlpha(60),
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    fontFamily: fonts.regular,
  },
  paneButton: { marginTop: 6, paddingHorizontal: 24 },
});
