import { memo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { fonts, nocturne as n } from '../../../theme/tokens';
import { Button } from '../../../ui/Button';
import { Sheet, SheetHeading } from '../../../ui/Sheet';
import { ErrorText } from '../../../ui/Text';
import { TextField } from '../../../ui/TextField';

/** Save as…: a name for the new saved filter (the filter, the search and the view). */
export const SaveAsSheet = memo(function SaveAsSheet({
  visible,
  onClose,
  name,
  onName,
  error,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  name: string;
  onName: (name: string) => void;
  error: string;
  onSave: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetHeading>Save as a new filter</SheetHeading>
      <Text style={styles.hint}>
        The filter, the search and the view, as a saved filter in Cove.
      </Text>
      <TextField
        value={name}
        onChangeText={onName}
        onSubmitEditing={onSave}
        placeholder="Name"
        autoFocus
        returnKeyType="done"
        style={styles.field}
      />
      {error ? <ErrorText style={styles.error}>{error}</ErrorText> : null}
      <Button
        label="Save"
        size="lg"
        disabled={!name.trim()}
        onPress={onSave}
        style={styles.save}
      />
    </Sheet>
  );
});

const styles = StyleSheet.create({
  hint: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    color: n.textAlpha(55),
    fontSize: 13,
    fontFamily: fonts.regular,
  },
  field: { marginHorizontal: 20 },
  error: { marginHorizontal: 20, marginTop: 8 },
  save: { marginHorizontal: 20, marginTop: 16 },
});
