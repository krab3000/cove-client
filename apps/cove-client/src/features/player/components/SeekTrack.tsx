import { useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { fonts, nocturne as n } from '../../../theme/tokens';

const GLOW = '#9184d9';
const TICK = '#d2cefd';
const THUMB = '#e7e5fe';

/**
 * The player's seek bar (design 1k / 1l): the played part glowing in accent, a tick per moment, and a thumb. A
 * finger (or the mouse) drags it: onScrub follows the drag (the bubble above shows that frame and the nearest
 * moment), onCommit seeks on release. `big` is the landscape track (5 px, 3×11 ticks, a 20 px thumb with a halo);
 * else the portrait one (3 px, 2×9 ticks, 13 px), flush with the bottom of the video.
 */
export function SeekTrack({
  value,
  markers,
  big,
  showThumb,
  scrub,
  bubble,
  onScrub,
  onCommit,
}: {
  value: number; // 0–1, played
  markers: number[]; // 0–1
  big: boolean;
  showThumb: boolean;
  scrub: number | null; // 0–1 while dragging
  // While dragging: the frame there and its label ("19:52 · Ridge line")
  bubble: { uri: string; label: string } | null;
  onScrub: (fraction: number) => void;
  onCommit: (fraction: number) => void;
}) {
  const [width, setWidth] = useState(1);
  // A video without generated frames (no thumbnails, no sprite sheet, no cover): the bubble keeps just its label.
  const [noFrames, setNoFrames] = useState(false);
  const at = (e: GestureResponderEvent) =>
    Math.min(1, Math.max(0, e.nativeEvent.locationX / width));
  const shown = scrub ?? value;
  const height = big ? 5 : 3;
  const thumb = big ? 20 : 13;
  const BUBBLE_W = 176;
  const bubbleLeft = Math.min(
    Math.max(0, shown * width - BUBBLE_W / 2),
    Math.max(0, width - BUBBLE_W)
  );
  return (
    <View
      style={styles.hit}
      onLayout={(e) => setWidth(Math.max(1, e.nativeEvent.layout.width))}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => onScrub(at(e))}
      onResponderMove={(e) => onScrub(at(e))}
      onResponderRelease={(e) => onCommit(at(e))}
      accessibilityRole="adjustable"
      accessibilityLabel="Seek"
    >
      {bubble ? (
        <View
          pointerEvents="none"
          style={[styles.bubble, { left: bubbleLeft, width: BUBBLE_W }]}
        >
          {noFrames ? null : bubble.uri ? (
            <Image
              source={{ uri: bubble.uri }}
              style={styles.frame}
              onError={() => setNoFrames(true)}
            />
          ) : (
            <View style={styles.frame} />
          )}
          <Text style={styles.bubbleLabel} numberOfLines={1}>
            {bubble.label}
          </Text>
        </View>
      ) : null}
      <View
        pointerEvents="none"
        style={[styles.track, { height }, big && styles.round]}
      >
        <View
          style={[
            styles.played,
            { width: `${shown * 100}%` },
            big && styles.round,
          ]}
        />
        {markers.map((m, i) => (
          <View
            key={i}
            style={[
              styles.tick,
              big ? styles.tickBig : styles.tickSmall,
              { left: `${m * 100}%` },
            ]}
          />
        ))}
        {showThumb || scrub !== null ? (
          <View
            style={[
              styles.thumb,
              {
                left: `${shown * 100}%`,
                width: thumb,
                height: thumb,
                borderRadius: thumb / 2,
                marginLeft: -thumb / 2,
                marginTop: -thumb / 2 + height / 2,
              },
              big && styles.halo,
            ]}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // A finger needs more than the thin track: the touch area is 32 px tall, the track in its middle.
  hit: { height: 32, justifyContent: 'center' },
  round: { borderRadius: 3 },
  track: {
    backgroundColor: 'rgba(233,233,237,0.22)',
  },
  played: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: GLOW,
    shadowColor: GLOW,
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 4,
  },
  tick: { position: 'absolute', backgroundColor: TICK },
  tickSmall: { top: -3, width: 2, height: 9, borderRadius: 1 },
  tickBig: { top: -3, width: 3, height: 11, borderRadius: 2 },
  thumb: {
    position: 'absolute',
    top: 0,
    backgroundColor: THUMB,
    shadowColor: GLOW,
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 6,
  },
  halo: {
    borderWidth: 5,
    borderColor: 'rgba(145,132,217,0.35)',
  },
  bubble: {
    position: 'absolute',
    bottom: 26,
    alignItems: 'center',
    gap: 6,
  },
  frame: {
    width: 176,
    height: 99,
    borderRadius: n.radiusMd,
    borderWidth: 1.5,
    borderColor: GLOW,
    backgroundColor: '#0a0b12',
  },
  bubbleLabel: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: 'rgba(14,15,24,0.75)',
    color: n.text,
    fontSize: 12,
    fontFamily: fonts.medium,
    fontVariant: ['tabular-nums'],
  },
});
