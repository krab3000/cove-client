import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../../ui/Button';
import { StatusDot } from '../../../ui/Text';
import { fonts, nocturne as n } from '../../../theme/tokens';
import { type KeptServer } from '../../../state/signIn';
import { ago } from '../../../lib/format';

/** A tablet's pane for a server that doesn't answer: what is known, and what to do. */
export function Unreachable({
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

const styles = StyleSheet.create({
  // A tablet's right pane, for a state with no accounts to show
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 48,
    gap: 10,
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
  buttons: { flexDirection: 'row', gap: 8, marginTop: 10 },
});
