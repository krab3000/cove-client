import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { CoveClient, CoveError } from '../api/cove';
import { Drawer } from '../components/Drawer';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { BackButton, MoreButton } from '../ui/IconButton';
import { PanelHeader } from '../ui/PanelHeader';
import { ErrorText, Spinner, StatusDot } from '../ui/Text';
import { TextField } from '../ui/TextField';
import { Sheet, SheetHeading, SheetRow, SheetRule } from '../components/Sheet';
import { fonts, nocturne as n } from '../theme/tokens';
import {
  hostOf,
  newServerId,
  normalizeAddress,
  withAccount,
  withServer,
  type KeptAccount,
  type KeptServer,
  type SignIn,
} from '../signIn';
import { ago, initialOf } from '../lib/format';
import { isLarge } from '../theme/layout';

const RADIUS_LG = 14;
// A large screen (tablet): the servers and the selected one's accounts side by side (design 1n)

const LIST_WIDTH = 380;
// Avatar fills, in turn (design 1b)
const AVATARS = [
  { fill: n.accent800, ink: n.accent100 },
  { fill: n.neutral800, ink: n.text },
  { fill: n.accent900, ink: n.accent300 },
];

type Change = (change: (state: SignIn) => SignIn) => void;

/**
 * Signing in (design 1a, 1b; on a tablet 1n): the servers you added — an editable list (⋮: Edit, Remove; Add server)
 * — and, for the one picked, the accounts kept on this device. A kept account goes straight in (its session is
 * resumed); a lock means it has no session (signed out, or it ran out), so it asks for the password. Cove has no
 * discovery and lists users only to admins, so both lists are the device's own. A phone shows one list at a time; a
 * tablet both, side by side.
 */
export function SignInScreen({
  state,
  onChange,
  onSignedIn,
  initialServerId,
}: {
  state: SignIn;
  onChange: Change;
  onSignedIn: (client: CoveClient, serverId: string) => void;
  // Opens on this server's accounts (after signing out of it, or when its session couldn't be resumed)
  initialServerId?: string;
}) {
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

  useEffect(() => {
    if (!serverId || large) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setServerId(null);
      return true;
    });
    return () => sub.remove();
  }, [serverId, large]);

  // Which servers answer (undefined: still asking); asked again on Try again
  const [reached, setReached] = useState<Record<string, boolean>>({});
  const [asking, setAsking] = useState(0);
  const addresses = state.servers.map((s) => `${s.id} ${s.address}`).join('\n');
  useEffect(() => {
    let alive = true;
    for (const line of addresses.split('\n').filter(Boolean)) {
      const [id = '', address = ''] = line.split(' ');
      CoveClient.reachable(address).then((ok) => {
        if (!alive) return;
        setReached((r) => ({ ...r, [id]: ok }));
        if (ok)
          onChange((s) =>
            withServer(s, id, (x) => ({ ...x, lastReached: Date.now() }))
          );
      });
    }
    return () => {
      alive = false;
    };
  }, [addresses, onChange, asking]);
  const askAgain = useCallback(() => {
    setReached({});
    setAsking((x) => x + 1);
  }, []);

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
    <Servers
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
                <Accounts
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
        <Accounts
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
        <Modal
          visible={!!menu}
          transparent
          animationType="fade"
          statusBarTranslucent
          navigationBarTranslucent
          onRequestClose={() => setMenu(null)}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setMenu(null)}
            accessibilityLabel="Close"
          />
          {menu?.anchor ? (
            <View
              style={[
                styles.popover,
                { top: menu.anchor.y + 4, left: menu.anchor.x - POPOVER_WIDTH },
              ]}
            >
              <MenuItem
                icon="pencil-simple"
                label="Edit"
                onPress={() => openEditor(menu.server)}
              />
              <MenuItem
                icon="trash"
                label="Remove server"
                onPress={() => removeServer(menu.server)}
              />
            </View>
          ) : null}
        </Modal>
      ) : (
        <Sheet visible={!!menu} onClose={() => setMenu(null)}>
          <Text style={styles.sheetCaption} numberOfLines={1}>
            {menu ? `${menu.server.name} · ${menu.server.address}` : ''}
          </Text>
          <SheetRow
            icon="pencil-simple"
            label="Edit"
            onPress={() => menu && openEditor(menu.server)}
          />
          <SheetRule />
          <SheetRow
            icon="trash"
            label="Remove server"
            meta="Forgets its address and the accounts kept for it"
            onPress={() => menu && removeServer(menu.server)}
          />
        </Sheet>
      )}
      {large ? null : (
        <Sheet visible={!!editing} onClose={() => setEditing(null)}>
          {form}
        </Sheet>
      )}
    </View>
  );
}

const POPOVER_WIDTH = 220;

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
      style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
    >
      <Icon name={icon} size={18} color={n.accent300} />
      <Text style={styles.menuText}>{label}</Text>
    </Pressable>
  );
}

// --- 1a: the servers ---------------------------------------------------------------------------------------------

function Servers({
  state,
  reached,
  selectedId,
  large,
  onPick,
  onMenu,
  onAdd,
}: {
  state: SignIn;
  reached: Record<string, boolean>;
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

/** Add / edit a server: in a phone's sheet, or a tablet's drawer (with its own header and ✕). */
function ServerForm({
  title,
  saveLabel,
  address,
  name,
  onAddress,
  onName,
  onCancel,
  onSave,
  drawer,
}: {
  title: string;
  saveLabel: string;
  address: string;
  name: string;
  onAddress: (text: string) => void;
  onName: (text: string) => void;
  onCancel: () => void;
  onSave: () => void;
  drawer: boolean;
}) {
  const valid = !!normalizeAddress(address);
  return (
    <View style={drawer ? styles.formDrawer : null}>
      {drawer ? (
        <PanelHeader title={title} onClose={onCancel} />
      ) : (
        <SheetHeading>{title}</SheetHeading>
      )}
      <View style={styles.form}>
        <Text style={styles.label}>Address</Text>
        <TextField
          value={address}
          onChangeText={onAddress}
          placeholder="https://cove.local:9999"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          autoFocus
          returnKeyType="next"
        />
        <Text style={styles.label}>Name (optional)</Text>
        <TextField
          value={name}
          onChangeText={onName}
          placeholder="e.g. Living Room NAS"
          onSubmitEditing={onSave}
          returnKeyType="done"
        />
        <Text style={styles.hint}>
          The address you open Cove at in a browser. Without a name, the list
          shows its host.
        </Text>
        <View style={styles.buttons}>
          <Button
            label="Cancel"
            variant="secondary"
            size="lg"
            onPress={onCancel}
          />
          <Button
            label={saveLabel}
            size="lg"
            grow
            disabled={!valid}
            onPress={onSave}
          />
        </View>
      </View>
    </View>
  );
}

/** A tablet's pane for a server that doesn't answer: what is known, and what to do. */
function Unreachable({
  server,
  onEdit,
  onRetry,
}: {
  server: KeptServer;
  onEdit: () => void;
  onRetry: () => void;
}) {
  return (
    <View style={styles.centered}>
      <View style={styles.pillCentered}>
        <StatusDot on={false} />
        <Text style={styles.pillText} numberOfLines={1}>
          {server.name}
        </Text>
      </View>
      <Text style={styles.paneTitle}>Can't reach {server.name}</Text>
      <Text style={styles.paneText}>
        {server.lastReached
          ? `Last reached ${ago(server.lastReached)} at ${server.address}. `
          : `Nothing answered at ${server.address}. `}
        Check that it is on, and on this network.
      </Text>
      <View style={styles.buttons}>
        <Button
          label="Edit server"
          variant="secondary"
          size="lg"
          onPress={onEdit}
        />
        <Button label="Try again" size="lg" onPress={onRetry} />
      </View>
    </View>
  );
}

// --- 1b: the accounts --------------------------------------------------------------------------------------------

function Accounts({
  server,
  large,
  onChange,
  onSignedIn,
  onBack,
}: {
  server: KeptServer;
  // A tablet's pane: no back (the list is beside it), centred
  large: boolean;
  onChange: Change;
  onSignedIn: (client: CoveClient, serverId: string) => void;
  onBack?: () => void;
}) {
  const empty = !server.accounts.length;
  const [edit, setEdit] = useState(false);
  // The account asking for its password, or 'add' (a new one); a server with none asks for one straight away
  const [card, setCard] = useState<string | 'add' | null>(empty ? 'add' : null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);

  const lock = useCallback(
    (name: string) =>
      onChange((s) =>
        withServer(s, server.id, (x) => withAccount(x, name, null))
      ),
    [onChange, server.id]
  );

  const pick = async (account: KeptAccount) => {
    if (edit || busy) return;
    setError('');
    if (!account.refreshToken) {
      setCard(account.username);
      setPassword('');
      return;
    }
    setCard(null);
    setBusy(account.username);
    try {
      onSignedIn(
        await CoveClient.resume(
          server.address,
          account.username,
          account.refreshToken
        ),
        server.id
      );
    } catch (e) {
      setBusy(null);
      if (e instanceof CoveError && (e.status === 401 || e.status === 409)) {
        // The session ran out (or was ended elsewhere): the password, then
        lock(account.username);
        setCard(account.username);
        setPassword('');
      } else setError(e instanceof Error ? e.message : String(e));
    }
  };

  const signIn = async () => {
    const name = card === 'add' ? username.trim() : card;
    if (!name || !password || busy) return;
    setBusy(name);
    setError('');
    try {
      onSignedIn(
        await CoveClient.login(server.address, name, password),
        server.id
      );
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const forget = (account: KeptAccount) => {
    if (account.refreshToken)
      CoveClient.revoke(server.address, account.refreshToken);
    onChange((s) => ({
      ...withServer(s, server.id, (x) => ({
        ...x,
        accounts: x.accounts.filter((a) => a.username !== account.username),
      })),
      last:
        s.last?.serverId === server.id && s.last.username === account.username
          ? null
          : s.last,
    }));
    if (card === account.username) setCard(null);
  };

  const tiles = useMemo(
    () =>
      server.accounts.map((a, i) => ({
        account: a,
        ...AVATARS[i % AVATARS.length]!,
      })),
    [server.accounts]
  );

  return (
    <KeyboardAvoidingView style={styles.fill} behavior="padding">
      <View
        style={[styles.accountsHeader, large && styles.accountsHeaderLarge]}
      >
        {large ? null : (
          <>
            <BackButton onPress={onBack!} accessibilityLabel="Servers" />
            <View style={styles.pill}>
              <StatusDot on />
              <Text style={styles.pillText} numberOfLines={1}>
                {server.name}
              </Text>
            </View>
          </>
        )}
        <View style={styles.grow} />
        {empty ? null : (
          <Button
            label={edit ? 'Done' : 'Edit'}
            variant="text"
            onPress={() => {
              setEdit((x) => !x);
              setCard(null);
            }}
          />
        )}
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.accountsContent,
          large && styles.accountsContentLarge,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {large ? (
          <View style={styles.pillCentered}>
            <StatusDot on />
            <Text style={styles.pillText} numberOfLines={1}>
              {server.name}
            </Text>
          </View>
        ) : null}
        <Text
          style={[styles.h1, styles.h1Accounts, large && styles.h1Centered]}
        >
          {empty ? 'Sign in' : "Who's watching?"}
        </Text>
        {empty ? null : (
          <View style={[styles.grid, large && styles.gridLarge]}>
            {tiles.map(({ account, fill, ink }) => {
              const selected = !edit && card === account.username;
              return (
                <Pressable
                  key={account.username}
                  onPress={() => pick(account)}
                  accessibilityLabel={`${account.username}, ${account.refreshToken ? 'signed in' : 'password needed'}`}
                  style={[styles.tile, large && styles.tileLarge]}
                >
                  <View
                    style={[
                      styles.avatar,
                      { backgroundColor: fill },
                      selected && styles.avatarSelected,
                      edit && styles.avatarEditing,
                    ]}
                  >
                    {busy === account.username ? (
                      <Spinner />
                    ) : (
                      <Text style={[styles.initial, { color: ink }]}>
                        {initialOf(account.username)}
                      </Text>
                    )}
                    {account.refreshToken ? null : (
                      <View style={styles.lock}>
                        <Icon
                          name="lock-simple"
                          fill
                          size={14}
                          color={n.text}
                        />
                      </View>
                    )}
                    {edit ? (
                      <Pressable
                        onPress={() => forget(account)}
                        accessibilityLabel={`Remove ${account.username}`}
                        hitSlop={6}
                        style={styles.remove}
                      >
                        <Icon name="x" size={15} color={n.text} />
                      </Pressable>
                    ) : null}
                  </View>
                  <Text style={styles.tileName} numberOfLines={1}>
                    {account.username}
                  </Text>
                  <Text style={styles.tileMeta}>
                    {account.refreshToken ? 'Signed in' : 'Password needed'}
                  </Text>
                </Pressable>
              );
            })}
            {edit ? null : (
              <Pressable
                onPress={() => {
                  setCard('add');
                  setUsername('');
                  setPassword('');
                  setError('');
                }}
                style={[styles.tile, large && styles.tileLarge]}
              >
                <View
                  style={[
                    styles.avatar,
                    styles.addAvatar,
                    card === 'add' && styles.addAvatarOn,
                  ]}
                >
                  <Icon name="plus" size={32} color={n.accent300} />
                </View>
                <Text style={styles.tileName}>Add account</Text>
                <Text style={styles.tileMeta}>Username and password</Text>
              </Pressable>
            )}
          </View>
        )}
        {error && !card ? (
          <ErrorText style={styles.error}>{error}</ErrorText>
        ) : null}
        {/* A tablet's card sits under the avatars, centred */}
        {large && card && !edit ? (
          <View style={[styles.card, styles.cardLarge]}>{cardBody()}</View>
        ) : null}
      </ScrollView>

      {!large && card && !edit ? (
        <View style={styles.card}>{cardBody()}</View>
      ) : null}
    </KeyboardAvoidingView>
  );

  function cardBody() {
    return (
      <>
        <Text style={styles.cardTitle}>
          {card === 'add' ? 'Sign in to ' : 'Password for '}
          <Text style={styles.cardStrong}>
            {card === 'add' ? server.name : card}
          </Text>
        </Text>
        {card === 'add' ? (
          <TextField
            value={username}
            onChangeText={setUsername}
            placeholder="Username"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus={!empty || !large}
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
        ) : null}
        <TextField
          ref={passwordRef}
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          secureTextEntry
          autoFocus={card !== 'add'}
          returnKeyType="go"
          onSubmitEditing={signIn}
        />
        {error ? <ErrorText>{error}</ErrorText> : null}
        <View style={styles.buttons}>
          {card === 'add' && !empty ? (
            <Button
              label="Cancel"
              variant="secondary"
              size="lg"
              onPress={() => setCard(null)}
            />
          ) : null}
          <Button
            label="Sign in"
            size="lg"
            grow
            busy={!!busy}
            onPress={signIn}
          />
        </View>
      </>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: n.bg },
  fill: { flex: 1 },
  panes: { flex: 1, flexDirection: 'row' },
  // The list on the sidebar's tint (1h)
  listPane: { width: LIST_WIDTH, backgroundColor: '#1d1f2c' },
  accountsPane: { flex: 1 },
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
  h1Accounts: { marginTop: 32, marginBottom: 0 },
  h1Centered: { marginTop: 10, textAlign: 'center' },
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
    borderRadius: RADIUS_LG,
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
  sheetCaption: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 6,
    color: n.textAlpha(55),
    fontSize: 12,
    fontFamily: fonts.regular,
  },
  // The tablet's ⋮ popover: opaque, the drawer's ring and shadow
  popover: {
    position: 'absolute',
    width: POPOVER_WIDTH,
    padding: 6,
    borderRadius: n.radiusMd + 4,
    backgroundColor: n.surface,
    boxShadow: `inset 0 0 0 1px ${n.textAlpha(10)}, 0 16px 40px rgba(0,0,0,0.5)`,
  },
  menuItem: {
    height: 44,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: n.radiusMd,
  },
  menuText: { color: n.text, fontSize: 15, fontFamily: fonts.regular },
  formDrawer: { flex: 1 },
  form: { paddingHorizontal: 20, paddingTop: 8, gap: 6 },
  label: {
    marginTop: 8,
    color: n.textAlpha(60),
    fontSize: 12,
    fontFamily: fonts.regular,
  },
  hint: {
    marginTop: 4,
    color: n.textAlpha(50),
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fonts.regular,
  },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 10 },
  grow: { flex: 1 },
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
  accountsHeader: {
    paddingTop: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  accountsHeaderLarge: { minHeight: 52 },
  pill: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: n.surface,
  },
  pillCentered: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pillText: {
    flexShrink: 1,
    color: n.textAlpha(70),
    fontSize: 13,
    fontFamily: fonts.regular,
  },
  accountsContent: { paddingBottom: 24 },
  accountsContentLarge: { paddingTop: 40, paddingBottom: 40 },
  grid: {
    paddingTop: 28,
    paddingHorizontal: 24,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 22,
  },
  gridLarge: { justifyContent: 'center', paddingTop: 36 },
  tile: { width: '50%', alignItems: 'center', gap: 4 },
  tileLarge: { width: 166 },
  avatar: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarSelected: {
    boxShadow: `0 0 0 3px ${n.bg}, 0 0 0 5px ${n.accent}, 0 0 24px ${n.accentAlpha(40)}`,
  },
  avatarEditing: { opacity: 0.8 },
  initial: { fontSize: 36, fontFamily: fonts.medium },
  lock: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: n.bg,
  },
  remove: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: n.surface,
    boxShadow: `0 0 0 3px ${n.bg}`,
  },
  addAvatar: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: n.divider,
  },
  addAvatarOn: { borderColor: n.accent },
  tileName: {
    marginTop: 6,
    color: n.text,
    fontSize: 15,
    fontFamily: fonts.medium,
  },
  tileMeta: { color: n.textAlpha(50), fontSize: 12, fontFamily: fonts.regular },
  error: { marginTop: 20, marginHorizontal: 24, textAlign: 'center' },
  card: {
    marginHorizontal: 16,
    marginBottom: 20,
    padding: 16,
    gap: 12,
    borderRadius: RADIUS_LG,
    backgroundColor: n.surface,
    boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
  },
  cardLarge: {
    alignSelf: 'center',
    width: 380,
    marginTop: 36,
    marginBottom: 0,
  },
  cardTitle: {
    color: n.textAlpha(65),
    fontSize: 13,
    fontFamily: fonts.regular,
  },
  cardStrong: { color: n.text },
});
