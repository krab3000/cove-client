import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Segment } from '../../../api/types';
import { formatDuration } from '../../../lib/format';
import { fonts, nocturne as n } from '../../../theme/tokens';
import { Sheet, SheetHeading, SheetRow, SheetSection } from '../../../ui/Sheet';
import { segmentLabel } from '../moments';

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** The player's settings: the speed, and the audio track when there is more than one. */
export function SettingsSheet({
  visible,
  onClose,
  rate,
  onRate,
  tracks,
  currentTrack,
  onTrack,
}: {
  visible: boolean;
  onClose: () => void;
  rate: number;
  onRate: (rate: number) => void;
  tracks: { index: number; label: string }[];
  currentTrack: number;
  onTrack: (index: number) => void;
}) {
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
