import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Segment } from '../../../api/types';
import { formatDuration } from '../../../utils/format';
import { fonts, nocturne as n } from '../../../theme/tokens';
import { useSnapshot } from 'valtio';
import {
  Sheet,
  SheetHeading,
  SheetRow,
  SheetRule,
  SheetSection,
} from '../../../ui/Sheet';
import { prefs } from '../../../state/prefs';
import { SwitchRow } from '../../settings/components/SettingsRows';
import { segmentLabel } from '../moments';

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

/**
 * The player's Playback sheet (design 7c): this video's speed, audio track (when there is more than one) and subtitles
 * (when it has any); two of the device's switches people reach for mid-video (hardware decoding, statistics); and
 * All settings.
 */
export function SettingsSheet({
  visible,
  onClose,
  rate,
  onRate,
  tracks,
  currentTrack,
  onTrack,
  subtitles,
  currentSubtitle,
  onSubtitle,
  onAllSettings,
}: {
  visible: boolean;
  onClose: () => void;
  rate: number;
  onRate: (rate: number) => void;
  tracks: { index: number; label: string }[];
  currentTrack: number;
  onTrack: (index: number) => void;
  subtitles: { index: number; label: string }[];
  // -1: none shown
  currentSubtitle: number;
  // A track's index, or -2 for none
  onSubtitle: (index: number) => void;
  onAllSettings: () => void;
}) {
  const { hardwareDecoding, stats } = useSnapshot(prefs);
  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetHeading>Playback</SheetHeading>
      <SheetSection>Speed</SheetSection>
      <View style={styles.rateRow}>
        {RATES.map((r) => (
          <Pressable
            key={r}
            onPress={() => onRate(r)}
            accessibilityState={{ selected: rate === r }}
            style={[styles.rateChip, rate === r && styles.rateChipOn]}
          >
            <Text
              style={[styles.rateChipText, rate === r && styles.rateChipTextOn]}
            >
              {r}×
            </Text>
          </Pressable>
        ))}
      </View>
      {tracks.length > 1 ? (
        <>
          <SheetSection>Audio</SheetSection>
          {tracks.map((t) => (
            <SheetRow
              key={t.index}
              icon="waveform"
              label={t.label}
              checked={t.index === currentTrack}
              onPress={() => {
                onTrack(t.index);
                onClose();
              }}
            />
          ))}
        </>
      ) : null}
      {subtitles.length ? (
        <>
          <SheetSection>Subtitles</SheetSection>
          {[{ index: -2, label: 'Off' }, ...subtitles].map((t) => (
            <SheetRow
              key={t.index}
              icon="closed-captioning"
              label={t.label}
              checked={
                t.index === -2
                  ? currentSubtitle < 0
                  : t.index === currentSubtitle
              }
              onPress={() => {
                onSubtitle(t.index);
                onClose();
              }}
            />
          ))}
        </>
      ) : null}
      <SheetSection>This device</SheetSection>
      <SwitchRow
        label="Hardware decoding"
        detail="Turn off if this video plays black, green or blocky. For every video on this device."
        on={hardwareDecoding}
        onPress={() => {
          prefs.hardwareDecoding = !hardwareDecoding;
        }}
      />
      <SwitchRow
        label="Playback statistics"
        detail="Decoder, cache and network, over the video."
        on={stats}
        onPress={() => {
          prefs.stats = !stats;
        }}
      />
      <SheetRule />
      <SheetRow
        icon="gear-six"
        label="All settings"
        meta="Cache, previews, diagnostics — on this device"
        onPress={onAllSettings}
      />
    </Sheet>
  );
}

/** 1l's Moments pill: the moments as a list that seeks (times in the clip's own time). */
export function MomentsSheet({
  visible,
  onClose,
  segments,
  currentId,
  clipStart,
  frameUrl,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  segments: Segment[];
  // The moment playing
  currentId: number | null;
  clipStart: number;
  frameUrl: (seconds: number) => string;
  onPick: (segment: Segment) => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetHeading>Moments</SheetHeading>
      <View>
        {segments.map((s) => {
          const on = currentId === s.id;
          return (
            <Pressable
              key={s.id}
              onPress={() => {
                onPick(s);
                onClose();
              }}
              style={({ pressed }) => [
                styles.momentRow,
                on && styles.momentRowOn,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.momentThumb}>
                <Image
                  source={{ uri: frameUrl(s.startSec) }}
                  style={StyleSheet.absoluteFill}
                  resizeMethod="resize"
                />
              </View>
              <Text
                style={[styles.momentLabel, on && styles.momentLabelOn]}
                numberOfLines={1}
              >
                {segmentLabel(s)}
              </Text>
              <Text style={styles.momentTime}>
                {formatDuration(s.startSec - clipStart)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  rateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
  },
  rateChip: {
    height: 38,
    minWidth: 56,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: n.radiusMd,
    borderWidth: 1,
    borderColor: n.divider,
  },
  rateChipOn: { borderColor: n.accent, backgroundColor: n.accentAlpha(12) },
  rateChipText: { color: n.text, fontSize: 14, fontFamily: fonts.regular },
  rateChipTextOn: { color: n.accent200, fontFamily: fonts.medium },
  momentRow: {
    minHeight: 64,
    paddingHorizontal: 20,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  momentRowOn: { backgroundColor: n.accentAlpha(10) },
  pressed: { backgroundColor: n.textAlpha(6) },
  momentThumb: {
    width: 96,
    height: 54,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: n.bg,
  },
  momentLabel: {
    flex: 1,
    color: n.text,
    fontSize: 14,
    fontFamily: fonts.regular,
  },
  momentLabelOn: { color: n.accent300 },
  momentTime: {
    color: n.accent300,
    fontSize: 12.5,
    fontFamily: fonts.medium,
    fontVariant: ['tabular-nums'],
  },
});
