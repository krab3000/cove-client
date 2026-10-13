import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSnapshot } from 'valtio';
import { version } from '../../../../package.json';
import {
  clearHttpCache,
  getHttpCacheStats,
  type HttpCacheStats,
} from '../../../platform/player';
import { prefs, resetPrefs, type Prefs } from '../../../state/prefs';
import { fonts, nocturne as n } from '../../../theme/tokens';
import { Button } from '../../../ui/Button';
import { CoveMark } from '../../../ui/CoveMark';
import { Icon } from '../../../ui/Icon';
import { Segmented } from '../../../ui/Segmented';
import { Switch } from '../../../ui/Switch';
import { choiceLabel, type Option, type Row } from '../model';

/** A settings list's rows (design 7a, 7d), set in from the sides by [pad]. [onChoice] opens a value's choices. */
export function SettingsRows({
  rows,
  onChoice,
  pad = 20,
}: {
  rows: Row[];
  onChoice: (row: Extract<Row, { kind: 'choice' }>) => void;
  pad?: number;
}) {
  const p = useSnapshot(prefs) as Prefs;
  return (
    <>
      {rows.map((row, i) => {
        switch (row.kind) {
          case 'switch':
            return (
              <SwitchRow
                key={i}
                label={row.label}
                detail={row.detail}
                tag={row.tag}
                on={p[row.key]}
                onPress={() => {
                  prefs[row.key] = !p[row.key];
                }}
                pad={pad}
              />
            );
          case 'segments':
            return (
              <View key={i} style={[styles.segRow, { paddingHorizontal: pad }]}>
                <Label label={row.label} detail={row.detail} />
                <Segmented
                  options={row.options}
                  value={p[row.key] as string | number}
                  onChange={(v) => {
                    (prefs as Record<string, unknown>)[row.key] = v;
                  }}
                  accessibilityLabel={row.label}
                />
              </View>
            );
          case 'choice':
            return (
              <Pressable
                key={i}
                onPress={() => onChoice(row)}
                accessibilityRole="button"
                accessibilityLabel={`${row.label}, ${choiceLabel(row, p[row.key])}`}
                style={({ pressed }) => [
                  styles.row,
                  { paddingHorizontal: pad },
                  pressed && styles.pressed,
                ]}
              >
                <Label label={row.label} detail={row.detail} grow />
                <ChoiceValue row={row} value={p[row.key]} />
                <Icon name="caret-right" size={15} color={n.textAlpha(40)} />
              </Pressable>
            );
          case 'usage':
            return <UsageCard key={i} pad={pad} />;
          case 'about':
            return <About key={i} pad={pad} />;
          case 'reset':
            return (
              <View key={i} style={[styles.reset, { paddingHorizontal: pad }]}>
                <Button
                  label="Reset to defaults"
                  icon="arrow-counter-clockwise"
                  variant="secondary"
                  onPress={resetPrefs}
                  style={styles.resetButton}
                />
              </View>
            );
        }
      })}
    </>
  );
}

/** A switch row: the whole row toggles it. */
export function SwitchRow({
  label,
  detail,
  tag,
  on,
  onPress,
  pad = 20,
}: {
  label: string;
  detail?: string;
  tag?: string;
  on: boolean;
  onPress: () => void;
  pad?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      style={({ pressed }) => [
        styles.row,
        { paddingHorizontal: pad },
        pressed && styles.pressed,
      ]}
    >
      <Label label={label} detail={detail} tag={tag} grow />
      <Switch on={on} />
    </Pressable>
  );
}

function Label({
  label,
  detail,
  tag,
  grow,
}: {
  label: string;
  detail?: string;
  tag?: string;
  grow?: boolean;
}) {
  return (
    <View style={[styles.label, grow && styles.grow]}>
      <View style={styles.labelLine}>
        <Text style={styles.labelText}>{label}</Text>
        {tag ? <Text style={styles.tag}>{tag}</Text> : null}
      </View>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
  );
}

// Auto shows what the device chose ("Auto · 16 MB"), from the cache's own figures.
function ChoiceValue({
  row,
  value,
}: {
  row: Extract<Row, { kind: 'choice' }>;
  value: number;
}) {
  const stats = useCacheStats(value === -1);
  let text = choiceLabel(row, value);
  if (value === -1 && stats)
    text += ` · ${size(row.key === 'memoryCacheMB' ? stats.ramLimit : stats.disk.limit)}`;
  return (
    <Text style={styles.value} numberOfLines={1}>
      {text}
    </Text>
  );
}

/** A value's choices (the phone's sheet, the tablet's dialog): 52 px rows, a check on the current one. */
export function ChoiceList({
  options,
  value,
  onPick,
}: {
  options: Option<number>[];
  value: number;
  onPick: (value: number) => void;
}) {
  return (
    <View>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onPick(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}
          >
            <Text style={[styles.optionText, on && styles.optionTextOn]}>
              {o.label}
            </Text>
            {on ? <Icon name="check" size={18} color={n.accent} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** The HTTP cache's figures, asked again every second while [on]; null where there is no cache (or not yet). */
function useCacheStats(on = true) {
  const [stats, setStats] = useState<HttpCacheStats | null>(null);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    const ask = () =>
      getHttpCacheStats()
        .then((s) => alive && setStats(s))
        .catch(() => {});
    ask();
    const timer = setInterval(ask, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [on]);
  return stats;
}

function size(bytes: number, fine = false) {
  const mb = bytes / (1 << 20);
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0)} GB`;
  if ((mb >= 10 && !fine) || mb === 0) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}

/** "14.8 MB of 15.2 MB": a decimal more when whole megabytes would read as full (or equal) and it isn't. */
function usedOf(used: number, limit: number) {
  const fine = used !== limit && size(used) === size(limit);
  return `${size(used, fine)} of ${size(limit, fine)}`;
}

/** What the player's cache holds, in memory and on disk, and Clear cache. */
function UsageCard({ pad }: { pad: number }) {
  const stats = useCacheStats();
  const [cleared, setCleared] = useState(false);
  const held = stats ? stats.ramBytes + stats.disk.bytes : 0;
  // "Cleared" until the cache holds something again
  useEffect(() => {
    if (cleared && held > 0) setCleared(false);
  }, [cleared, held]);
  const meters = stats
    ? [
        {
          label: 'In memory',
          value: usedOf(stats.ramBytes, stats.ramLimit),
          part: stats.ramLimit ? stats.ramBytes / stats.ramLimit : 0,
        },
        {
          label: 'On disk',
          value: stats.disk.enabled
            ? `${usedOf(stats.disk.bytes, stats.disk.limit)}${stats.disk.chunks ? ` · ${stats.disk.chunks.toLocaleString('en-US')} chunks` : ''}`
            : 'Off',
          part: stats.disk.limit ? stats.disk.bytes / stats.disk.limit : 0,
        },
      ]
    : [];
  return (
    <View style={[styles.usage, { marginHorizontal: pad }]}>
      {stats ? (
        meters.map((m) => (
          <View key={m.label} style={styles.meter}>
            <View style={styles.meterLine}>
              <Text style={styles.meterLabel}>{m.label}</Text>
              <Text style={styles.meterValue}>{m.value}</Text>
            </View>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  { width: `${Math.min(100, m.part * 100)}%` },
                ]}
              />
            </View>
          </View>
        ))
      ) : (
        <Text style={styles.detail}>The cache’s figures aren’t available.</Text>
      )}
      <View style={styles.usageFoot}>
        <Text style={[styles.detail, styles.grow]}>
          {cleared
            ? 'Empty. What you watch next is fetched again.'
            : 'Parts of the videos you’ve watched. Also cleared when you log out.'}
        </Text>
        <Button
          label={cleared ? 'Cleared' : 'Clear cache'}
          icon={cleared ? 'check' : 'trash'}
          variant={cleared ? 'secondary' : 'primary'}
          size="sm"
          disabled={cleared}
          onPress={() => {
            clearHttpCache();
            setCleared(true);
          }}
        />
      </View>
    </View>
  );
}

function deviceName() {
  const c = Platform.constants as unknown as Record<string, unknown>;
  if (Platform.OS === 'android')
    return (
      `${c.Manufacturer ?? ''} ${c.Model ?? ''}`.trim() +
      ` · Android ${c.Release ?? ''}`
    );
  if (Platform.OS === 'windows') return 'Windows';
  return Platform.OS;
}

function About({ pad }: { pad: number }) {
  return (
    <View style={{ paddingHorizontal: pad }}>
      <View style={styles.brand}>
        <CoveMark size={48} />
        <View style={styles.label}>
          <Text style={styles.brandName}>Cove Mobile</Text>
          <Text style={styles.detail}>Version {version}</Text>
        </View>
      </View>
      <View style={styles.pair}>
        <Text style={styles.pairLabel}>This device</Text>
        <Text style={styles.pairValue} numberOfLines={2}>
          {deviceName()}
        </Text>
      </View>
      <Text style={[styles.detail, styles.note]}>
        Settings here are kept on this device, for every account on it. Signing
        out keeps them.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 60,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  pressed: { backgroundColor: n.textAlpha(5) },
  segRow: { paddingTop: 12, paddingBottom: 14, gap: 10 },
  label: { minWidth: 0, gap: 3 },
  grow: { flex: 1 },
  labelLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  labelText: { color: n.text, fontSize: 15, fontFamily: fonts.regular },
  tag: {
    paddingHorizontal: 6,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: n.divider,
    color: n.textAlpha(60),
    fontSize: 10.5,
    lineHeight: 16,
    fontFamily: fonts.regular,
  },
  detail: {
    color: n.textAlpha(55),
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fonts.regular,
  },
  value: {
    flexShrink: 0,
    maxWidth: '45%',
    color: n.accent300,
    fontSize: 14,
    fontFamily: fonts.regular,
  },
  option: {
    minHeight: 52,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  optionText: {
    flex: 1,
    color: n.text,
    fontSize: 15,
    fontFamily: fonts.regular,
  },
  optionTextOn: { color: n.accent300 },
  usage: {
    marginTop: 6,
    marginBottom: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
    borderRadius: n.radiusLg,
    backgroundColor: n.surface,
  },
  meter: { gap: 7 },
  meterLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  meterLabel: { color: n.text, fontSize: 13, fontFamily: fonts.regular },
  meterValue: {
    flexShrink: 1,
    color: n.textAlpha(60),
    fontSize: 13,
    fontFamily: fonts.regular,
    fontVariant: ['tabular-nums'],
  },
  track: { height: 3, borderRadius: 2, backgroundColor: n.textAlpha(12) },
  fill: {
    height: 3,
    borderRadius: 2,
    backgroundColor: n.accent,
    boxShadow: `0 0 8px ${n.accent}`,
  },
  usageFoot: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingTop: 14,
    paddingBottom: 10,
  },
  brandName: { color: n.text, fontSize: 16, fontFamily: fonts.medium },
  pair: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  pairLabel: { color: n.text, fontSize: 14.5, fontFamily: fonts.regular },
  pairValue: {
    flexShrink: 1,
    textAlign: 'right',
    color: n.textAlpha(60),
    fontSize: 13.5,
    fontFamily: fonts.regular,
  },
  note: { paddingTop: 6, paddingBottom: 10 },
  reset: { paddingTop: 8, paddingBottom: 4, alignItems: 'flex-start' },
  resetButton: { alignSelf: 'flex-start' },
});
