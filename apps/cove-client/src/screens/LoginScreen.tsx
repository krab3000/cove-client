import { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CoveClient } from '../api/cove';
import { Button, colors } from '../components/Controls';

const DEFAULT_SERVER = 'https://cove.haloworld.lan';

export function LoginScreen({
  onLogin,
}: {
  onLogin: (client: CoveClient) => void;
}) {
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (busy || !server || !username) return;
    setBusy(true);
    setError('');
    try {
      onLogin(await CoveClient.login(server, username, password));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.panel}>
        <Text style={styles.heading}>Cove</Text>
        <Text style={styles.label}>Server</Text>
        <TextInput
          style={styles.input}
          value={server}
          onChangeText={setServer}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={submit}
        />
        <Text style={styles.label}>Username</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={submit}
        />
        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoFocus
          onSubmitEditing={submit}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.actions}>
          {busy ? <ActivityIndicator color={colors.accent} /> : null}
          <Button title="Log in" onPress={submit} disabled={busy} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  panel: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
  },
  heading: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '600',
    marginBottom: 12,
  },
  label: { color: colors.textDim, marginTop: 12, marginBottom: 4 },
  input: {
    color: colors.text,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  error: { color: colors.error, marginTop: 12 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
    marginTop: 20,
  },
});
