import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import type { CoveClient, SpriteSheet } from '../api/cove';
import type { Video } from '../api/types';
import { Bar, colors } from '../components/Controls';
import { SeekPreview } from '../components/SeekPreview';
import { formatDuration, videoTitle } from '../format';
import {
  playerEngine,
  VideoView,
  type LoadEvent,
  type VideoViewHandle,
} from '../player';

const touch = Platform.OS === 'android';
// Controls hide after this long without input while playing.
const HIDE_AFTER_MS = 3000;
// Two taps within this are a double tap (touch: seek on the left or right third).
const DOUBLE_TAP_MS = 300;
// After a double-tap seek, single taps on the same side keep seeking for this long (tap, tap, tap: -30 s).
const SEEK_STREAK_MS = 700;
const SEEK_STEP = 10;

type Side = 'left' | 'middle' | 'right';

/**
 * The player: the video fills the screen and the controls float over it (a top bar, play/pause and ±10 s in the
 * middle, the seek bar and audio controls at the bottom). They hide by themselves while playing and come back on
 * a tap, a mouse move or a pause. The layout follows the screen's orientation.
 *
 * Plays a video's original file, streamed from Cove over HTTP(S) range requests. A clip (a video cut from another
 * one) plays its parent's file between clipStartSec and clipEndSec.
 */
export function PlayerScreen({
  client,
  video,
  onClose,
}: {
  client: CoveClient;
  video: Video;
  onClose: () => void;
}) {
  const player = useRef<VideoViewHandle>(null);
  const [info, setInfo] = useState<LoadEvent | null>(null);
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const [ended, setEnded] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [audioTrack, setAudioTrack] = useState(-1);
  const [time, setTime] = useState(0);
  // The playing time, always current; `time` (what the controls show) follows it only while they are visible, so
  // progress reports do not re-render the screen while the controls are hidden.
  const timeRef = useRef(0);
  const [seeking, setSeeking] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // The pointer over the seek bar, for the preview above it (mounted from the first hover on).
  const [hover, setHover] = useState<{
    fraction: number;
    width: number;
  } | null>(null);
  const [previewMounted, setPreviewMounted] = useState(false);
  const [barWidth, setBarWidth] = useState(0);
  const [sprite, setSprite] = useState<SpriteSheet | null>(null);
  const [flash, setFlash] = useState<{
    side: 'left' | 'right';
    seconds: number;
  } | null>(null);

  const landscape = size.width > size.height;
  const clipStart = video.parentVideoId ? (video.clipStartSec ?? 0) : 0;
  const clipEnd = video.parentVideoId ? video.clipEndSec : null;
  const duration =
    clipEnd != null
      ? clipEnd - clipStart
      : Math.max(0, (info?.duration ?? 0) - clipStart);
  // Times on screen are relative to the clip.
  const position = Math.max(0, (scrub ?? time) - clipStart);
  // Where the seek-bar preview shows: the drag position (touch, or a mouse drag), else the hovered one.
  const previewAt =
    scrub !== null && duration > 0
      ? Math.min(1, Math.max(0, (scrub - clipStart) / duration))
      : (hover?.fraction ?? null);

  // Android: the back gesture closes the player, and the status bar hides while it is open.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    if (touch) StatusBar.setHidden(true, 'fade');
    return () => {
      sub.remove();
      if (touch) StatusBar.setHidden(false, 'fade');
    };
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    client.spriteSheet(video).then((sheet) => alive && setSprite(sheet));
    return () => {
      alive = false;
    };
  }, [client, video]);

  // --- Controls visibility -------------------------------------------------------------------------------------
  const [controls, setControls] = useState(true);
  const opacity = useRef(new Animated.Value(1)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overControls = useRef(false);
  // They stay up while nothing plays, or while the user scrubs.
  const pinned = !info || !!error || paused || ended || scrub !== null;
  const visible = controls || pinned;
  // The controls come back showing the current time.
  useEffect(() => {
    if (visible) setTime(timeRef.current);
  }, [visible]);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!overControls.current) setControls(false);
    }, HIDE_AFTER_MS);
  }, []);

  const showControls = useCallback(() => {
    setControls(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    if (pinned) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setControls(true);
    } else {
      scheduleHide();
    }
  }, [pinned, scheduleHide]);

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: visible ? 150 : 400,
      useNativeDriver: Platform.OS !== 'windows',
    }).start();
  }, [visible, opacity]);

  // --- Playback ------------------------------------------------------------------------------------------------
  const seekTo = useCallback(
    (seconds: number) => {
      const t =
        clipStart + Math.min(Math.max(0, seconds), Math.max(0, duration));
      timeRef.current = t;
      setTime(t);
      setSeeking(true);
      setEnded(false);
      player.current?.seek(t);
    },
    [clipStart, duration]
  );

  // A seek that never reports back (a stream error) must not leave the spinner up.
  useEffect(() => {
    if (!seeking) return;
    const timer = setTimeout(() => setSeeking(false), 5000);
    return () => clearTimeout(timer);
  }, [seeking, time]);

  const togglePause = useCallback(() => {
    if (ended) {
      seekTo(0);
      setPaused(false);
      return;
    }
    setPaused((p) => !p);
  }, [ended, seekTo]);

  const skip = (seconds: number) => {
    seekTo(Math.max(0, timeRef.current - clipStart) + seconds);
    showControls();
  };

  // --- Taps on the video ---------------------------------------------------------------------------------------
  const lastTap = useRef<{ at: number; side: Side } | null>(null);
  const streak = useRef<{
    until: number;
    side: 'left' | 'right';
    seconds: number;
  } | null>(null);
  const singleTap = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      for (const timer of [hideTimer, singleTap, flashTimer])
        if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const seekBySide = (side: 'left' | 'right', now: number) => {
    const s = streak.current;
    const seconds =
      s && s.side === side && now < s.until ? s.seconds + SEEK_STEP : SEEK_STEP;
    streak.current = { until: now + SEEK_STREAK_MS, side, seconds };
    seekTo(
      Math.max(0, timeRef.current - clipStart) +
        (side === 'left' ? -SEEK_STEP : SEEK_STEP)
    );
    setFlash({ side, seconds });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), SEEK_STREAK_MS);
  };

  const toggleControls = () => {
    if (visible && !pinned) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setControls(false);
    } else {
      showControls();
    }
  };

  const onVideoPress = (e: GestureResponderEvent) => {
    if (!touch) {
      // Mouse: a click plays or pauses (moving the mouse already shows the controls).
      togglePause();
      showControls();
      return;
    }
    const now = Date.now();
    const x = e.nativeEvent.locationX / Math.max(1, size.width);
    const side: Side = x < 1 / 3 ? 'left' : x > 2 / 3 ? 'right' : 'middle';
    if (singleTap.current) clearTimeout(singleTap.current);
    if (side !== 'middle') {
      const s = streak.current;
      const prev = lastTap.current;
      if (
        (s && s.side === side && now < s.until) || // tap, tap, tap: keep seeking
        (prev && prev.side === side && now - prev.at < DOUBLE_TAP_MS)
      ) {
        lastTap.current = null;
        seekBySide(side, now);
        return;
      }
    }
    lastTap.current = { at: now, side };
    // A single tap shows or hides the controls; on the sides it waits to see whether a second tap follows.
    if (side === 'middle') toggleControls();
    else singleTap.current = setTimeout(toggleControls, DOUBLE_TAP_MS);
  };

  // --- Layout --------------------------------------------------------------------------------------------------
  // Room for the system bars and the camera cutout on Android (drawn edge to edge, status bar hidden).
  const insets = touch
    ? landscape
      ? { top: 12, bottom: 20, side: 48 }
      : { top: 40, bottom: 48, side: 12 }
    : { top: 12, bottom: 12, side: 16 };
  const tracks = info?.audioTracks ?? [];
  const currentTrack =
    audioTrack === -1 ? (info?.audioTrack ?? -1) : audioTrack;
  const trackIndex = tracks.findIndex((t) => t.index === currentTrack);
  const track = trackIndex >= 0 ? tracks[trackIndex] : undefined;
  const trackLabel = track
    ? [track.language, track.title, `${track.channels}ch`]
        .filter(Boolean)
        .join(' · ')
    : '';
  const details = info
    ? [
        `${info.width}×${info.height}`,
        info.codec,
        info.hwDecoding ? 'HW' : 'SW',
        playerEngine,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  // The controls stay up while the mouse is on them.
  const hoverHandlers = {
    onPointerEnter: () => {
      overControls.current = true;
    },
    onPointerLeave: () => {
      overControls.current = false;
      if (!pinned) scheduleHide();
    },
  };

  return (
    <View
      style={styles.screen}
      onLayout={(e) =>
        setSize({
          width: e.nativeEvent.layout.width,
          height: e.nativeEvent.layout.height,
        })
      }
      // Mouse: any move shows the controls.
      onPointerMove={touch ? undefined : showControls}
    >
      <VideoView
        ref={player}
        style={StyleSheet.absoluteFill}
        source={client.streamUrl(video)}
        paused={paused}
        muted={muted}
        volume={volume}
        audioTrack={audioTrack}
        // Behind TLS-inspecting antivirus (Windows) or with a CA the user installed (Android), the player's own
        // TLS check fails; the app's fetch already checked this server at login.
        tlsVerify={false}
        // Android: a hardware overlay, no GPU copy of every (4K) frame.
        overlay
        onLoad={(e) => {
          setInfo(e.nativeEvent);
          if (clipStart > 0) player.current?.seek(clipStart);
        }}
        onProgress={(e) => {
          if (scrub !== null || seeking) return;
          timeRef.current = e.nativeEvent.currentTime;
          if (visible) setTime(e.nativeEvent.currentTime);
          if (clipEnd != null && e.nativeEvent.currentTime >= clipEnd) {
            setPaused(true);
            setEnded(true);
          }
        }}
        onSeek={(e) => {
          timeRef.current = e.nativeEvent.currentTime;
          setTime(e.nativeEvent.currentTime);
          setSeeking(false);
        }}
        onEnd={() => {
          setEnded(true);
          setPaused(true);
        }}
        onError={(e) => setError(e.nativeEvent.message)}
      />

      {/* Taps and clicks on the video itself, under the controls. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onVideoPress} />

      {flash ? (
        <View
          pointerEvents="none"
          style={[
            styles.flash,
            flash.side === 'left' ? styles.flashLeft : styles.flashRight,
          ]}
        >
          <Text style={styles.flashText}>
            {flash.side === 'left' ? '«' : '»'} {flash.seconds} s
          </Text>
        </View>
      ) : null}

      {(!info && !error) || seeking ? (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator size="large" color={colors.text} />
        </View>
      ) : null}

      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity }]}
        pointerEvents={visible ? 'box-none' : 'none'}
      >
        {/* Top: back, title, details */}
        <View
          style={[
            styles.top,
            {
              paddingTop: insets.top,
              paddingLeft: insets.side,
              paddingRight: insets.side,
            },
          ]}
          {...hoverHandlers}
        >
          <Pressable onPress={onClose} hitSlop={12} style={styles.back}>
            <Text style={styles.backText}>‹</Text>
          </Pressable>
          <View style={styles.titleBlock}>
            <Text style={styles.title} numberOfLines={landscape ? 1 : 2}>
              {videoTitle(video)}
            </Text>
            {details ? (
              <Text style={styles.details} numberOfLines={1}>
                {details}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Middle: -10 s, play/pause, +10 s */}
        {info && !error && !seeking ? (
          <View style={styles.center} pointerEvents="box-none">
            <View style={[styles.centerRow, { gap: landscape ? 56 : 36 }]}>
              <RoundButton label="↺" sub="10" onPress={() => skip(-SEEK_STEP)} />
              <RoundButton
                big
                label={ended ? '↻' : paused ? '▶' : '❚❚'}
                onPress={() => {
                  togglePause();
                  showControls();
                }}
              />
              <RoundButton label="↻" sub="10" onPress={() => skip(SEEK_STEP)} />
            </View>
          </View>
        ) : null}

        {error ? (
          <View style={styles.center} pointerEvents="none">
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}

        {/* Bottom: seek bar, then audio controls */}
        <View
          style={[
            styles.bottom,
            {
              paddingBottom: insets.bottom,
              paddingLeft: insets.side,
              paddingRight: insets.side,
            },
          ]}
          {...hoverHandlers}
        >
          <View style={styles.seekRow}>
            <Text style={styles.time}>{formatDuration(position)}</Text>
            {previewMounted && duration > 0 ? (
              <SeekPreview
                sprite={sprite}
                time={clipStart + (previewAt ?? 0) * duration}
                label={(previewAt ?? 0) * duration}
                left={TIME_WIDTH + ROW_GAP + (previewAt ?? 0) * barWidth}
                visible={previewAt !== null}
              />
            ) : null}
            <Bar
              onWidth={setBarWidth}
              onHover={(h) => {
                setHover(h);
                if (h) setPreviewMounted(true);
              }}
              value={duration > 0 ? position / duration : 0}
              onChange={(v) => {
                // Dragging (finger or mouse) only moves the bar and the preview; the seek happens on release.
                setScrub(clipStart + v * duration);
                setPreviewMounted(true);
              }}
              onRelease={(v) => {
                setScrub(null);
                seekTo(v * duration);
              }}
            />
            <Text style={styles.time}>{formatDuration(duration)}</Text>
          </View>
          <View style={styles.actions}>
            <Pressable
              onPress={() => setMuted(!muted)}
              hitSlop={8}
              style={styles.pill}
            >
              <Text style={styles.pillText}>
                {muted || volume === 0 ? 'Unmute' : 'Mute'}
              </Text>
            </Pressable>
            {/* Phones have volume keys; the desktop gets a slider. */}
            {!touch ? (
              <Bar
                value={muted ? 0 : volume}
                onChange={(v) => {
                  setVolume(v);
                  if (v > 0) setMuted(false);
                }}
                width={110}
              />
            ) : null}
            <View style={styles.spacer} />
            {tracks.length > 1 ? (
              <Pressable
                hitSlop={8}
                style={styles.pill}
                onPress={() => {
                  // Cycles through the audio tracks.
                  const next =
                    tracks[(Math.max(0, trackIndex) + 1) % tracks.length]!;
                  setAudioTrack(next.index);
                  showControls();
                }}
              >
                <Text style={styles.pillText} numberOfLines={1}>
                  Audio: {trackLabel || `track ${trackIndex + 1}`} (
                  {trackIndex + 1}/{tracks.length})
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

function RoundButton({
  label,
  sub,
  big,
  onPress,
}: {
  label: string;
  sub?: string;
  big?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [
        styles.round,
        big && styles.roundBig,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.roundLabel, big && styles.roundLabelBig]}>
        {label}
      </Text>
      {sub ? <Text style={styles.roundSub}>{sub}</Text> : null}
    </Pressable>
  );
}

const TIME_WIDTH = 64;
const ROW_GAP = 10;
const SHADE = 'rgba(0,0,0,0.55)';

const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  center: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 14,
    backgroundColor: SHADE,
  },
  back: { paddingHorizontal: 8 },
  backText: { color: colors.text, fontSize: 34, lineHeight: 38 },
  titleBlock: { flex: 1 },
  title: { color: colors.text, fontSize: 17, fontWeight: '600' },
  details: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  centerRow: { flexDirection: 'row', alignItems: 'center' },
  round: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: SHADE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roundBig: { width: 76, height: 76, borderRadius: 38 },
  pressed: { opacity: 0.6 },
  roundLabel: { color: colors.text, fontSize: 22, lineHeight: 26 },
  roundLabelBig: { fontSize: 30, lineHeight: 34 },
  roundSub: { color: colors.text, fontSize: 10, marginTop: -2 },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: 8,
    paddingTop: 12,
    backgroundColor: SHADE,
  },
  seekRow: { flexDirection: 'row', alignItems: 'center', gap: ROW_GAP },
  time: {
    color: colors.text,
    width: TIME_WIDTH,
    textAlign: 'center',
    fontSize: 13,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  spacer: { flex: 1 },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.12)',
    maxWidth: 280,
  },
  pillText: { color: colors.text, fontSize: 14 },
  flash: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '33%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  flashLeft: { left: 0 },
  flashRight: { right: 0 },
  flashText: { color: colors.text, fontSize: 18, fontWeight: '600' },
  error: { color: colors.error, textAlign: 'center', paddingHorizontal: 32 },
});
