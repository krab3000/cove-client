import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../../ui/Button';
import { PanelHeader } from '../../../ui/PanelHeader';
import { TextField } from '../../../ui/TextField';
import { SheetHeading } from '../../../ui/Sheet';
import { fonts, nocturne as n } from '../../../theme/tokens';
import { normalizeAddress } from '../../../signIn';

/** Add / edit a server: in a phone's sheet, or a tablet's drawer (with its own header and ✕). */
export function ServerForm({
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

const styles = StyleSheet.create({
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
});
