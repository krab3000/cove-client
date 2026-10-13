import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fonts, nocturne as n } from '../../../theme/tokens';
import { Avatar } from '../../../ui/Avatar';
import { Sheet, SheetRow, SheetRule } from '../../../ui/Sheet';
import { StatusDot } from '../../../ui/Text';

/** The avatar's account sheet (design 6e): who and where, Refresh library, this device's Settings, Log out. */
export const AccountSheet = memo(function AccountSheet({
  visible,
  onClose,
  username,
  server,
  onRefresh,
  onSettings,
  onLogout,
}: {
  visible: boolean;
  onClose: () => void;
  username: string;
  server: string;
  onRefresh: () => void;
  onSettings: () => void;
  onLogout: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.account}>
        <Avatar name={username} size={48} letters="one" />
        <View style={styles.accountText}>
          <Text style={styles.accountName} numberOfLines={1}>
            {username}
          </Text>
          <View style={styles.accountServer}>
            <StatusDot on />
            <Text style={styles.accountServerText} numberOfLines={1}>
              {server.replace(/^https?:\/\//, '')}
            </Text>
          </View>
        </View>
      </View>
      <SheetRule />
      <SheetRow
        icon="arrow-clockwise"
        label="Refresh library"
        onPress={() => {
          onClose();
          onRefresh();
        }}
      />
      <SheetRow
        icon="gear-six"
        label="Settings"
        meta="This device"
        onPress={() => {
          onClose();
          onSettings();
        }}
      />
      <SheetRow
        icon="sign-out"
        label="Log out"
        onPress={() => {
          onClose();
          onLogout();
        }}
      />
    </Sheet>
  );
});

const styles = StyleSheet.create({
  account: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  accountText: { flex: 1, minWidth: 0, gap: 2 },
  accountName: { color: n.text, fontSize: 17, fontFamily: fonts.medium },
  accountServer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  accountServerText: {
    flexShrink: 1,
    color: n.textAlpha(55),
    fontSize: 12.5,
    fontFamily: fonts.regular,
  },
});
