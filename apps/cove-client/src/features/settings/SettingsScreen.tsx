import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSnapshot } from 'valtio';
import { Layer, useBackHandler } from '../../app/back';
import { prefs, type Prefs } from '../../state/prefs';
import { closeSettings, settingsScreen } from '../../state/settings';
import { fonts, nocturne as n, raisedEdge } from '../../theme/tokens';
import { isLarge } from '../../theme/layout';
import { Icon } from '../../ui/Icon';
import { BackButton, CloseButton } from '../../ui/IconButton';
import { Sheet, SheetHeading } from '../../ui/Sheet';
import { SmoothEdges } from '../../platform/SmoothEdges';
import { SECTIONS, type Row } from './model';
import { ChoiceList, SettingsRows } from './components/SettingsRows';

type ChoiceRow = Extract<Row, { kind: 'choice' }>;

const BACK_LABEL = { library: 'Library', signIn: 'Servers', player: 'Player' };

/**
 * The device's settings (design turn 7): kept on this device, for every account on it. A phone shows one scrolling
 * page (7a); a tablet its sections on the left and one of them on the right (7d). A row with a value opens its
 * choices: a bottom sheet on a phone (7b), a small dialog on a tablet. Over everything, the player included.
 */
export function SettingsScreen() {
  const { from, section } = useSnapshot(settingsScreen);
  const window = useWindowDimensions();
  const large = isLarge(window.width, window.height);
  const [choice, setChoice] = useState<ChoiceRow | null>(null);
  useBackHandler(closeSettings, Layer.settings);

  const back = (
    <View style={styles.backRow}>
      <BackButton
        onPress={closeSettings}
        accessibilityLabel={`Back to ${BACK_LABEL[from]}`}
      />
      {large ? <Text style={styles.backLabel}>{BACK_LABEL[from]}</Text> : null}
    </View>
  );

  return (
    <View style={styles.screen}>
      {large ? (
        <View style={styles.panes}>
          <View style={styles.nav}>
            {back}
            <Text style={[styles.h1, styles.h1Large]}>Settings</Text>
            <Text style={styles.navSubtitle}>On this device</Text>
            {SECTIONS.map((s, i) => {
              const on = i === section;
              return (
                <Pressable
                  key={s.title}
                  onPress={() => {
                    settingsScreen.section = i;
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  style={({ pressed }) => [
                    styles.navRow,
                    on && styles.navRowOn,
                    pressed && !on && styles.pressed,
                  ]}
                >
                  <Icon
                    name={s.icon}
                    fill={on}
                    size={20}
                    color={on ? n.accent : n.textAlpha(80)}
                  />
                  <Text style={[styles.navLabel, on && styles.navLabelOn]}>
                    {s.title}
                  </Text>
                </Pressable>
              );
            })}
            <View style={styles.grow} />
            <Text style={styles.navNote}>
              For everyone who uses Cove on this device. Your server’s own
              settings are in Cove’s web UI.
            </Text>
          </View>
          <ScrollView
            style={styles.grow}
            contentContainerStyle={styles.mainContent}
          >
            <View style={styles.column}>
              <Text style={styles.h2}>{SECTIONS[section]!.title}</Text>
              <Text style={styles.sectionText}>
                {SECTIONS[section]!.description}
              </Text>
              <SettingsRows
                rows={SECTIONS[section]!.rows}
                onChoice={setChoice}
              />
            </View>
          </ScrollView>
        </View>
      ) : (
        <>
          {back}
          <ScrollView contentContainerStyle={styles.pageContent}>
            <Text style={[styles.h1, styles.pagePad]}>Settings</Text>
            <Text style={[styles.intro, styles.pagePad]}>
              On this device, for everyone who uses Cove on it. Your server’s
              own settings are in Cove’s web UI.
            </Text>
            {SECTIONS.map((s) => (
              <View key={s.title}>
                <Text style={styles.sectionHead}>{s.title.toUpperCase()}</Text>
                <SettingsRows rows={s.rows} onChoice={setChoice} />
              </View>
            ))}
          </ScrollView>
        </>
      )}
      <Choices row={choice} large={large} onClose={() => setChoice(null)} />
    </View>
  );
}

/** A value's choices: a bottom sheet (phone) or a dialog (tablet). Picking one sets it and closes. */
function Choices({
  row,
  large,
  onClose,
}: {
  row: ChoiceRow | null;
  large: boolean;
  onClose: () => void;
}) {
  const p = useSnapshot(prefs) as Prefs;
  // Kept while the sheet fades out
  const [shown, setShown] = useState<ChoiceRow | null>(row);
  if (row && row !== shown) setShown(row);
  const r = row ?? shown;
  const body = r ? (
    <>
      <Text style={styles.choiceText}>{r.explain}</Text>
      <ChoiceList
        options={r.options}
        value={p[r.key]}
        onPick={(v) => {
          prefs[r.key] = v;
          onClose();
        }}
      />
    </>
  ) : null;
  if (!large)
    return (
      <Sheet visible={!!row} onClose={onClose}>
        {r ? <SheetHeading>{r.label}</SheetHeading> : null}
        {body}
      </Sheet>
    );
  return (
    <Modal
      visible={!!row}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <SmoothEdges />
      <Pressable
        style={styles.scrim}
        onPress={onClose}
        accessibilityLabel="Close"
      />
      <View style={styles.dialogPlace} pointerEvents="box-none">
        <View style={styles.dialog}>
          <View style={styles.dialogHead}>
            <Text style={styles.dialogTitle}>{r?.label}</Text>
            <CloseButton onPress={onClose} />
          </View>
          {body}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: n.bg },
  grow: { flex: 1 },
  pressed: { backgroundColor: n.textAlpha(6) },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingTop: 4,
    paddingHorizontal: 8,
  },
  backLabel: {
    color: n.textAlpha(60),
    fontSize: 13.5,
    fontFamily: fonts.regular,
  },
  h1: {
    color: n.text,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.6,
    fontFamily: fonts.medium,
  },
  h1Large: {
    fontSize: 28,
    lineHeight: 34,
    marginTop: 18,
    marginHorizontal: 12,
  },
  // Phone (7a)
  pageContent: { paddingTop: 4, paddingBottom: 40 },
  pagePad: { paddingHorizontal: 20 },
  intro: {
    marginTop: 6,
    color: n.textAlpha(60),
    fontSize: 13,
    lineHeight: 19.5,
    fontFamily: fonts.regular,
  },
  sectionHead: {
    paddingHorizontal: 20,
    paddingTop: 26,
    paddingBottom: 6,
    color: n.textAlpha(50),
    fontSize: 11.5,
    letterSpacing: 0.9,
    fontFamily: fonts.regular,
  },
  // Tablet (7d)
  panes: { flex: 1, flexDirection: 'row' },
  nav: {
    width: 300,
    paddingTop: 12,
    paddingHorizontal: 12,
    paddingBottom: 18,
    gap: 2,
    backgroundColor: n.sidebar,
  },
  navSubtitle: {
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 18,
    color: n.textAlpha(60),
    fontSize: 13,
    fontFamily: fonts.regular,
  },
  navRow: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    borderRadius: n.radiusMd,
  },
  navRowOn: { backgroundColor: n.accentAlpha(13) },
  navLabel: { color: n.textAlpha(80), fontSize: 14, fontFamily: fonts.regular },
  navLabelOn: { color: n.accent },
  navNote: {
    marginHorizontal: 12,
    color: n.textAlpha(50),
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fonts.regular,
  },
  mainContent: { paddingTop: 30, paddingHorizontal: 28, paddingBottom: 40 },
  column: { maxWidth: 660 },
  h2: {
    marginHorizontal: 20,
    marginBottom: 4,
    color: n.text,
    fontSize: 24,
    letterSpacing: -0.24,
    fontFamily: fonts.medium,
  },
  sectionText: {
    marginHorizontal: 20,
    marginBottom: 14,
    color: n.textAlpha(60),
    fontSize: 13,
    lineHeight: 19.5,
    fontFamily: fonts.regular,
  },
  // Choices
  choiceText: {
    paddingHorizontal: 20,
    paddingBottom: 10,
    color: n.textAlpha(55),
    fontSize: 12.5,
    lineHeight: 18.75,
    fontFamily: fonts.regular,
  },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: n.scrim },
  dialogPlace: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dialog: {
    width: 420,
    paddingTop: 8,
    paddingBottom: 12,
    borderRadius: n.radiusSheet,
    backgroundColor: n.surface,
    ...raisedEdge(n.textAlpha(10), '0 24px 60px rgba(0,0,0,0.5)'),
  },
  dialogHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 6,
    paddingLeft: 20,
    paddingRight: 12,
    paddingBottom: 4,
  },
  dialogTitle: {
    flex: 1,
    color: n.text,
    fontSize: 17,
    fontFamily: fonts.medium,
  },
});
