import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CoveClient, authFailure } from '../../../api/cove';
import { Button } from '../../../ui/Button';
import { Icon } from '../../../ui/Icon';
import { BackButton } from '../../../ui/IconButton';
import { ErrorText, Spinner, StatusDot } from '../../../ui/Text';
import { TextField } from '../../../ui/TextField';
import { fonts, nocturne as n } from '../../../theme/tokens';
import {
  withAccount,
  withServer,
  type KeptAccount,
  type KeptServer,
  type SignIn,
} from '../../../state/signIn';
import { initialOf } from '../../../lib/format';

// Avatar fills, in turn (design 1b)
const AVATARS = [
  { fill: n.accent800, ink: n.accent100 },
  { fill: n.neutral800, ink: n.text },
  { fill: n.accent900, ink: n.accent300 },
];

type Change = (change: (state: SignIn) => SignIn) => void;

// --- 1b: the accounts --------------------------------------------------------------------------------------------

export function AccountsPane({
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
      if (authFailure(e) === 'expired') {
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
            <BackButton onPress={onBack!} accessibilityLabel="ServerList" />
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
  fill: { flex: 1 },
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
  pillText: {
    flexShrink: 1,
    color: n.textAlpha(70),
    fontSize: 13,
    fontFamily: fonts.regular,
  },
  grow: { flex: 1 },
  accountsContent: { paddingBottom: 24 },
  accountsContentLarge: { paddingTop: 40, paddingBottom: 40 },
  pillCentered: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
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
  h1Accounts: { marginTop: 32, marginBottom: 0 },
  h1Centered: { marginTop: 10, textAlign: 'center' },
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
  tileName: {
    marginTop: 6,
    color: n.text,
    fontSize: 15,
    fontFamily: fonts.medium,
  },
  tileMeta: { color: n.textAlpha(50), fontSize: 12, fontFamily: fonts.regular },
  addAvatar: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: n.divider,
  },
  addAvatarOn: { borderColor: n.accent },
  error: { marginTop: 20, marginHorizontal: 24, textAlign: 'center' },
  card: {
    marginHorizontal: 16,
    marginBottom: 20,
    padding: 16,
    gap: 12,
    borderRadius: n.radiusLg,
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
  buttons: { flexDirection: 'row', gap: 8, marginTop: 10 },
});
