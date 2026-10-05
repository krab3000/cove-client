import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { primaryFile, type CoveClient } from '../api/cove';
import type { Engagement, Segment, Video } from '../api/types';
import { Bar } from '../components/Controls';
import { Icon, type IconName } from '../components/Icon';
import { SeekTrack } from '../components/SeekTrack';
import {
  Sheet,
  SheetHeading,
  SheetRow,
  SheetSection,
} from '../components/Sheet';
import { partialDate } from '../components/VideoRow';
import { fonts, nocturne as n } from '../filter/theme';
import { formatDuration, resolutionLabel, videoTitle } from '../format';
import {
  playerEngine,
  VideoView,
  type LoadEvent,
  type VideoViewHandle,
} from '../player';
import { useSystemInsets } from '../systemInsets';

const touch = Platform.OS === 'android';
// Controls hide after this long without input while playing.
const HIDE_AFTER_MS = 3000;
// Two taps within this are a double tap (touch: seek on the left or right third).
const DOUBLE_TAP_MS = 300;
// After a double-tap seek, single taps on the same side keep seeking for this long (tap, tap, tap: -30 s).
const SEEK_STREAK_MS = 700;
const SEEK_STEP = 10;
// The speed pill steps through these.
const RATES = [1, 1.25, 1.5, 2, 0.5, 0.75];
// Resume where the user left off, unless that is near the start or the end.
const RESUME_MIN_SEC = 5;
const RESUME_END_MARGIN_SEC = 15;
// The scrub bubble asks for a frame once the drag rests this long.
const FRAME_REST_MS = 150;
// Playback reports to Cove while playing (resume position, views).
const REPORT_EVERY_MS = 10000;
// A large screen (shorter side at least this) held sideways gets the tablet player (1m).
const LARGE = 600;
// 1m: the side panel's width, the space around the video, and the back row above it.
const PANEL = 360;
const TABLET_PAD = 24;
const TABLET_BAR = 60;
// Over the video: dark in both themes.
const INK = '#e9e9ed';
const INK_DIM = '#cfd3e5';

type Side = 'left' | 'middle' | 'right';

/** The name a segment goes by: its title, else its tag, else its kind. */
function segmentLabel(s: Segment): string {
  return s.title?.trim() || s.tagName || s.kind || 'Moment';
}

/**
 * The player (design 1k / 1l).
 *
 * Phone, upright (1k): the video at the top with its controls over it (minimize, settings; −10 s, play/pause, +10 s;
 * the time and full screen), the seek bar flush under it with a tick per moment, and below: the title, actions
 * (Save for later, Start over, speed), the moments (frames that seek), the people, and Up next with Autoplay.
 *
 * Turned sideways, on a desktop, or with full screen (1l): the video fills the screen; the controls float over it
 * (back, title, speed, lock; the transport; the seek bar, whose bubble shows the frame and the nearest moment while
 * dragging; the time, Moments and Next). They hide by themselves while playing and come back on a tap.
 *
 * Plays a video's original file, streamed from Cove over HTTP(S) range requests. A clip (a video cut from another
 * one) plays its parent's file between clipStartSec and clipEndSec. Resumes where the user left off, and reports
 * what was watched to Cove like its web player (resume position, views).
 */
export function PlayerScreen({
  client,
  video,
  upNext,
  onPlayNext,
  autoplay,
  onAutoplay,
  onClose,
  startAt,
}: {
  client: CoveClient;
  video: Video;
  // The videos after this one in the Library's order
  upNext: Video[];
  onPlayNext: (video: Video, upNext: Video[]) => void;
  autoplay: boolean;
  onAutoplay: (on: boolean) => void;
  onClose: () => void;
  // Start here (seconds in the file: a moment picked in the Library) instead of where the user left off
  startAt?: number;
}) {
  const player = useRef<VideoViewHandle>(null);
  const [info, setInfo] = useState<LoadEvent | null>(null);
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const [ended, setEnded] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);
  const [audioTrack, setAudioTrack] = useState(-1);
  const [time, setTime] = useState(0);
  // The playing time, always current; `time` (what the controls show) follows it only while they are visible, so
  // progress reports do not re-render the screen while the controls are hidden.
  const timeRef = useRef(0);
  const [seeking, setSeeking] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null); // 0–1 while dragging the seek bar
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [flash, setFlash] = useState<{
    side: 'left' | 'right';
    seconds: number;
  } | null>(null);
  // Upright phone: the full-screen button shows the landscape layout over the whole (upright) screen.
  const [fullscreen, setFullscreen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockHint, setLockHint] = useState(false);
  const [sheet, setSheet] = useState<'settings' | 'moments' | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [savedForLater, setSavedForLater] = useState(false);

  const landscape = size.width > size.height;
  const large = Math.min(size.width, size.height) >= LARGE;
  // 1l: full screen (asked for, or a phone held sideways, or a small desktop window). 1m: a large screen held
  // sideways (tablet, desktop window). 1k: upright (phone or tablet).
  const immersive = fullscreen || (landscape && !large) || (!touch && !large);
  const tablet = !immersive && large && landscape;
  const clipStart = video.parentVideoId ? (video.clipStartSec ?? 0) : 0;
  const clipEnd = video.parentVideoId ? video.clipEndSec : null;
  const fileDuration = info?.duration ?? primaryFile(video)?.duration ?? 0;
  const duration =
    clipEnd != null
      ? clipEnd - clipStart
      : Math.max(0, fileDuration - clipStart);
  // Times on screen are relative to the clip.
  const position = Math.max(0, time - clipStart);
  const scrubSeconds = scrub !== null ? scrub * duration : null;

  // --- Cove data: moments, Save for later, where the user left off -------------------------------------------------
  const resumeAt = useRef<number | null>(
    startAt != null
      ? startAt - (video.parentVideoId ? (video.clipStartSec ?? 0) : 0)
      : null
  );
  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const [panelTab, setPanelTab] = useState<'moments' | 'next' | 'details'>(
    'moments'
  );
  const resumed = useRef(false);
  useEffect(() => {
    let alive = true;
    client.segments(video).then((s) => alive && setSegments(s));
    client.savedForLater([video.id]).then(
      (set) => alive && setSavedForLater(set.has(video.id)),
      () => {}
    );
    client.engagement([video.id]).then(
      (list) => {
        if (!alive) return;
        setEngagement(list[0] ?? null);
        if (startAt == null) resumeAt.current = list[0]?.resumeTime ?? 0;
        tryResume();
      },
      () => {}
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, video]);
  const markers = useMemo(
    () =>
      duration > 0
        ? segments
            .map((s) => (s.startSec - clipStart) / duration)
            .filter((f) => f >= 0 && f <= 1)
        : [],
    [segments, duration, clipStart]
  );
  // The moment the playhead (or the drag) is in: the last one started before it.
  const momentAt = (seconds: number) =>
    [...segments].reverse().find((s) => s.startSec - clipStart <= seconds) ??
    null;
  const current = momentAt(position);

  // Android: the back gesture leaves full screen, then closes the player; the status bar hides while it is open.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (sheet) setSheet(null);
      else if (fullscreen) setFullscreen(false);
      else onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose, fullscreen, sheet]);
  useEffect(() => {
    if (!touch) return;
    StatusBar.setHidden(true, 'fade');
    return () => StatusBar.setHidden(false, 'fade');
  }, []);

  // --- Controls visibility -------------------------------------------------------------------------------------
  const [controls, setControls] = useState(true);
  const opacity = useRef(new Animated.Value(1)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overControls = useRef(false);
  // They stay up while nothing plays, or while the user scrubs; a locked screen shows none.
  const pinned = !info || !!error || paused || ended || scrub !== null;
  const visible = !locked && (controls || pinned);
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
      duration: 250,
      useNativeDriver: Platform.OS !== 'windows',
    }).start();
  }, [visible, opacity]);

  // --- Playback reports (resume position, views) ---------------------------------------------------------------
  const session = useMemo(() => uuid(), []);
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const playingRef = useRef(false);
  playingRef.current = !!info && !paused && !ended && !error;
  const endedRef = useRef(false);
  endedRef.current = ended;
  // The span played without a jump since the last report, and the spans waiting to be sent.
  const span = useRef<{ start: number; end: number } | null>(null);
  const spans = useRef<{ startSec: number; endSec: number }[]>([]);
  const closeSpan = () => {
    const s = span.current;
    if (s && s.end - s.start >= 0.5)
      spans.current.push({ startSec: s.start, endSec: s.end });
    span.current = null;
  };
  const report = useCallback(
    (state: 'active' | 'paused' | 'ended') => {
      const s = span.current;
      closeSpan();
      if (s) span.current = { start: s.end, end: s.end };
      const total = durationRef.current;
      if (!total) return;
      const intervals = spans.current;
      spans.current = [];
      client
        .recordPlayback({
          hostId: video.id,
          sessionId: session,
          mediaDurationSec: total,
          currentPositionSec: Math.max(0, timeRef.current - clipStart),
          state,
          intervals,
        })
        .catch(() => {});
    },

    [client, video, session, clipStart]
  );
  useEffect(() => {
    const timer = setInterval(() => {
      if (playingRef.current) report('active');
    }, REPORT_EVERY_MS);
    return () => {
      clearInterval(timer);
      report(endedRef.current ? 'ended' : 'paused');
    };
  }, [report]);
  // A pause is worth a report (the resume position).
  const wasPaused = useRef(paused);
  useEffect(() => {
    if (paused && !wasPaused.current && info)
      report(ended ? 'ended' : 'paused');
    wasPaused.current = paused;
  }, [paused, ended, info, report]);

  // --- Playback ------------------------------------------------------------------------------------------------
  const seekTo = useCallback(
    (seconds: number) => {
      const t =
        clipStart + Math.min(Math.max(0, seconds), Math.max(0, duration));
      closeSpan();
      timeRef.current = t;
      setTime(t);
      setSeeking(true);
      setEnded(false);
      player.current?.seek(t);
    },

    [clipStart, duration]
  );
  // Where the user left off, once both the player and Cove have answered.
  const tryResume = () => {
    if (resumed.current || !info || resumeAt.current == null) return;
    resumed.current = true;
    const at = resumeAt.current;
    if (startAt != null) seekTo(at);
    else if (at > RESUME_MIN_SEC && at < duration - RESUME_END_MARGIN_SEC)
      seekTo(at);
  };
  useEffect(tryResume);

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
  const next = upNext[0];
  const playNext = () => {
    if (next) onPlayNext(next, upNext.slice(1));
  };
  const cycleRate = () => {
    setRate((r) => RATES[(RATES.indexOf(r) + 1) % RATES.length] ?? 1);
    showControls();
  };
  const toggleFavorite = () => {
    const on = !engagement?.isFavorite;
    setEngagement((e) => (e ? { ...e, isFavorite: on } : e));
    client
      .setFavorite(video.id, on)
      .catch(() => setEngagement((e) => (e ? { ...e, isFavorite: !on } : e)));
  };
  const toggleLater = () => {
    const on = !savedForLater;
    setSavedForLater(on);
    client.setSavedForLater(video.id, on).catch(() => setSavedForLater(!on));
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
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      for (const timer of [hideTimer, singleTap, flashTimer, lockTimer])
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
  const [videoWidth, setVideoWidth] = useState(1);
  const onVideoPress = (e: GestureResponderEvent) => {
    if (locked) {
      // Locked: a tap only shows the unlock button for a moment.
      setLockHint(true);
      if (lockTimer.current) clearTimeout(lockTimer.current);
      lockTimer.current = setTimeout(() => setLockHint(false), 2500);
      return;
    }
    if (!touch) {
      // Mouse: a click plays or pauses (moving the mouse already shows the controls).
      togglePause();
      showControls();
      return;
    }
    const now = Date.now();
    const x = e.nativeEvent.locationX / videoWidth;
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
  // 1m keeps its details and side panel above the navigation bar (a tablet's taskbar)
  const barBottom = useSystemInsets()?.bottom ?? 0;
  const insets = touch
    ? landscape
      ? { top: 12, bottom: 18, side: 48 }
      : { top: 36, bottom: 40, side: 16 }
    : { top: 12, bottom: 14, side: 20 };
  const videoHeight = Math.round((size.width * 9) / 16);
  // 1m: the video left of the side panel, under the back row
  const tabletWidth = Math.max(1, size.width - PANEL - 2 * TABLET_PAD);
  const tabletHeight = Math.round((tabletWidth * 9) / 16);
  const tabletTop = insets.top + TABLET_BAR;
  const box = immersive
    ? { top: 0, left: 0, width: size.width, height: size.height }
    : tablet
      ? {
          top: tabletTop,
          left: TABLET_PAD,
          width: tabletWidth,
          height: tabletHeight,
        }
      : { top: insets.top, left: 0, width: size.width, height: videoHeight };
  const tracks = info?.audioTracks ?? [];
  const currentTrack =
    audioTrack === -1 ? (info?.audioTrack ?? -1) : audioTrack;
  const trackLabel = (t: (typeof tracks)[number], i: number) =>
    [t.language, t.title, `${t.channels}ch`].filter(Boolean).join(' · ') ||
    `Track ${i + 1}`;
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
  const meta = [
    video.studioName,
    resolutionLabel(video),
    video.date ? partialDate(video.date) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const shownPosition = scrubSeconds ?? position;
  // The bubble's frame follows the drag once it rests a moment: a frame request per pixel of dragging would never
  // finish loading one.
  const [frameUri, setFrameUri] = useState('');
  const frameSecond =
    scrubSeconds !== null ? clipStart + Math.round(scrubSeconds) : null;
  useEffect(() => {
    if (frameSecond === null) return;
    const timer = setTimeout(
      () => setFrameUri(client.frameUrl(video, frameSecond)),
      FRAME_REST_MS
    );
    return () => clearTimeout(timer);
  }, [client, video, frameSecond]);
  const bubble =
    scrubSeconds !== null
      ? {
          uri: frameUri,
          label: [
            formatDuration(scrubSeconds),
            momentAt(scrubSeconds)
              ? segmentLabel(momentAt(scrubSeconds)!)
              : null,
          ]
            .filter(Boolean)
            .join(' · '),
        }
      : null;
  const track = (big: boolean) => (
    <SeekTrack
      big={big}
      value={duration > 0 ? position / duration : 0}
      markers={markers}
      showThumb={visible}
      scrub={scrub}
      bubble={bubble}
      onScrub={(f) => {
        setScrub(f);
        showControls();
      }}
      onCommit={(f) => {
        setScrub(null);
        seekTo(f * duration);
      }}
    />
  );
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
  const tabletChrome = (
    <>
      <Shade edge="bottom" />
      {info && !error && !seeking ? (
        <View style={styles.center} pointerEvents="box-none">
          <View style={[styles.transport, styles.transportWide]}>
            <IconButton
              icon="clock-counter-clockwise"
              size={32}
              label="Back 10 seconds"
              onPress={() => skip(-SEEK_STEP)}
            />
            <PlayButton
              size={76}
              icon={
                ended ? 'arrow-counter-clockwise' : paused ? 'play' : 'pause'
              }
              onPress={() => {
                togglePause();
                showControls();
              }}
            />
            <IconButton
              icon="clock-clockwise"
              size={32}
              label="Forward 10 seconds"
              onPress={() => skip(SEEK_STEP)}
            />
          </View>
        </View>
      ) : null}
      <View style={styles.mBottom} {...hoverHandlers}>
        {track(true)}
        <View style={styles.lFooter}>
          <Text style={styles.lTime}>
            {formatDuration(shownPosition)}
            <Text style={styles.lTimeDim}>
              {'  / '}
              {formatDuration(duration)}
            </Text>
            {current ? (
              <Text style={styles.lTimeDim}>
                {'  · ' + segmentLabel(current)}
              </Text>
            ) : null}
          </Text>
          <View style={styles.spacer} />
          {!touch ? (
            <>
              <IconButton
                icon={muted || volume === 0 ? 'speaker-slash' : 'speaker-high'}
                size={18}
                label={muted ? 'Unmute' : 'Mute'}
                onPress={() => setMuted(!muted)}
              />
              <Bar
                value={muted ? 0 : volume}
                onChange={(v) => {
                  setVolume(v);
                  if (v > 0) setMuted(false);
                }}
                width={110}
              />
            </>
          ) : null}
          <Pressable
            onPress={cycleRate}
            accessibilityLabel={`Speed ${rate}×`}
            style={styles.ratePill}
          >
            <Text style={styles.ratePillText}>{rate}×</Text>
          </Pressable>
          <IconButton
            icon="corners-out"
            size={20}
            label="Full screen"
            onPress={() => setFullscreen(true)}
          />
        </View>
      </View>
    </>
  );
  const playIcon: IconName = ended
    ? 'arrow-counter-clockwise'
    : paused
      ? 'play'
      : 'pause';

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
      {/* The video: the whole screen (1l), or a 16:9 box at the top (1k). The same view either way, so turning the
          phone keeps playing. */}
      <View
        // Only its place and size change between the layouts (same style keys): React then keeps the native video
        // view where it is. Moved, Android would destroy its surface, and the picture would go black.
        style={[styles.box, box]}
        onLayout={(e) => setVideoWidth(Math.max(1, e.nativeEvent.layout.width))}
      >
        <VideoView
          ref={player}
          style={StyleSheet.absoluteFill}
          source={client.streamUrl(video)}
          paused={paused}
          muted={muted}
          volume={volume}
          rate={rate}
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
            const t = e.nativeEvent.currentTime;
            timeRef.current = t;
            // The span played since the last jump grows with it.
            const rel = Math.max(0, t - clipStart);
            const s = span.current;
            if (s && rel >= s.end && rel - s.end < 3) s.end = rel;
            else {
              closeSpan();
              span.current = { start: rel, end: rel };
            }
            if (visible) setTime(t);
            if (clipEnd != null && t >= clipEnd) {
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
            report('ended');
            if (autoplay && next) playNext();
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
            <ActivityIndicator size="large" color={INK} />
          </View>
        ) : null}
        {error ? (
          <View style={styles.center} pointerEvents="none">
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}

        {locked && lockHint ? (
          <Pressable
            onPress={() => {
              setLocked(false);
              setLockHint(false);
              showControls();
            }}
            accessibilityLabel="Unlock"
            style={[styles.unlock, { left: insets.side }]}
          >
            <Icon name="lock-simple" size={22} color={INK} />
          </Pressable>
        ) : null}

        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity }]}
          pointerEvents={visible ? 'box-none' : 'none'}
        >
          {tablet ? (
            tabletChrome
          ) : immersive ? (
            // --- 1l: over the whole screen ---------------------------------------------------------------------
            <>
              <Shade edge="top" />
              <Shade edge="bottom" />
              <View
                style={[
                  styles.lTop,
                  {
                    top: insets.top,
                    left: insets.side,
                    right: insets.side,
                  },
                ]}
                {...hoverHandlers}
              >
                <IconButton
                  icon="caret-left"
                  size={22}
                  label={fullscreen ? 'Leave full screen' : 'Back'}
                  onPress={() =>
                    fullscreen ? setFullscreen(false) : onClose()
                  }
                />
                <View style={styles.lTitle}>
                  <Text style={styles.lTitleText} numberOfLines={1}>
                    {videoTitle(video)}
                  </Text>
                  <Text style={styles.lSub} numberOfLines={1}>
                    {[video.studioName, details].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Pressable
                  onPress={cycleRate}
                  accessibilityLabel={`Speed ${rate}×`}
                  style={styles.ratePill}
                >
                  <Text style={styles.ratePillText}>{rate}×</Text>
                </Pressable>
                {touch ? (
                  <IconButton
                    icon="lock-simple-open"
                    size={20}
                    label="Lock the controls"
                    onPress={() => {
                      setLocked(true);
                      setControls(false);
                    }}
                  />
                ) : null}
              </View>

              {info && !error && !seeking ? (
                <View style={styles.center} pointerEvents="box-none">
                  <View style={[styles.transport, styles.transportWide]}>
                    <IconButton
                      icon="clock-counter-clockwise"
                      size={32}
                      label="Back 10 seconds"
                      onPress={() => skip(-SEEK_STEP)}
                    />
                    <PlayButton
                      size={72}
                      icon={playIcon}
                      onPress={() => {
                        togglePause();
                        showControls();
                      }}
                    />
                    <IconButton
                      icon="clock-clockwise"
                      size={32}
                      label="Forward 10 seconds"
                      onPress={() => skip(SEEK_STEP)}
                    />
                  </View>
                </View>
              ) : null}

              <View
                style={[
                  styles.lBottom,
                  {
                    bottom: insets.bottom,
                    left: insets.side,
                    right: insets.side,
                  },
                ]}
                {...hoverHandlers}
              >
                {track(true)}
                <View style={styles.lFooter}>
                  <Text style={styles.lTime}>
                    {formatDuration(shownPosition)}
                    <Text style={styles.lTimeDim}>
                      {'  / '}
                      {formatDuration(duration)}
                    </Text>
                  </Text>
                  <View style={styles.spacer} />
                  {!touch ? (
                    <>
                      <IconButton
                        icon={
                          muted || volume === 0
                            ? 'speaker-slash'
                            : 'speaker-high'
                        }
                        size={18}
                        label={muted ? 'Unmute' : 'Mute'}
                        onPress={() => setMuted(!muted)}
                      />
                      <Bar
                        value={muted ? 0 : volume}
                        onChange={(v) => {
                          setVolume(v);
                          if (v > 0) setMuted(false);
                        }}
                        width={110}
                      />
                    </>
                  ) : null}
                  {tracks.length > 1 ? (
                    <Pill
                      icon="waveform"
                      label="Audio"
                      onPress={() => setSheet('settings')}
                    />
                  ) : null}
                  {segments.length ? (
                    <Pill
                      icon="list-bullets"
                      label="Moments"
                      onPress={() => setSheet('moments')}
                    />
                  ) : null}
                  {next ? (
                    <Pill icon="skip-forward" label="Next" onPress={playNext} />
                  ) : null}
                  {fullscreen ? (
                    <IconButton
                      icon="corners-in"
                      size={20}
                      label="Leave full screen"
                      onPress={() => setFullscreen(false)}
                    />
                  ) : null}
                </View>
              </View>
            </>
          ) : (
            // --- 1k: over the video box -------------------------------------------------------------------------
            <View style={styles.kScrim} pointerEvents="box-none">
              <View style={styles.kTop}>
                <IconButton
                  icon="caret-down"
                  size={22}
                  label="Close the player"
                  onPress={onClose}
                />
                <IconButton
                  icon="gear-six"
                  size={20}
                  label="Settings"
                  onPress={() => setSheet('settings')}
                />
              </View>
              {info && !error && !seeking ? (
                <View style={styles.center} pointerEvents="box-none">
                  <View style={[styles.transport, styles.transportNarrow]}>
                    <IconButton
                      icon="clock-counter-clockwise"
                      size={28}
                      label="Back 10 seconds"
                      onPress={() => skip(-SEEK_STEP)}
                    />
                    <PlayButton
                      size={64}
                      icon={playIcon}
                      onPress={() => {
                        togglePause();
                        showControls();
                      }}
                    />
                    <IconButton
                      icon="clock-clockwise"
                      size={28}
                      label="Forward 10 seconds"
                      onPress={() => skip(SEEK_STEP)}
                    />
                  </View>
                </View>
              ) : null}
              <View style={styles.kBottom}>
                <Text style={styles.kTime}>
                  {formatDuration(shownPosition)}
                  <Text style={styles.kTimeDim}>
                    {'  / '}
                    {formatDuration(duration)}
                  </Text>
                </Text>
                <View style={styles.spacer} />
                <IconButton
                  icon="corners-out"
                  size={18}
                  label="Full screen"
                  onPress={() => setFullscreen(true)}
                />
              </View>
            </View>
          )}
        </Animated.View>

        {/* 1k: the seek bar sits on the bottom edge of the video, always there (the thumb comes with the controls). */}
        {!immersive && !tablet ? (
          <View style={styles.kTrack}>{track(false)}</View>
        ) : null}
      </View>

      {!immersive && !tablet ? (
        <ScrollView
          style={[styles.details, { marginTop: insets.top + videoHeight }]}
          contentContainerStyle={styles.detailsContent}
        >
          <View style={styles.pad}>
            <Text style={styles.title}>{videoTitle(video)}</Text>
            <Text style={styles.meta}>{meta}</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pills}
          >
            <Pill
              icon="bookmark-simple"
              fill={savedForLater}
              on={savedForLater}
              label={savedForLater ? 'Saved for later' : 'Save for later'}
              onPress={toggleLater}
              large
            />
            <Pill
              icon="arrow-counter-clockwise"
              label="Start over"
              onPress={() => {
                seekTo(0);
                setPaused(false);
              }}
              large
            />
            <Pill icon="gauge" label={`${rate}×`} onPress={cycleRate} large />
            {tracks.length > 1 ? (
              <Pill
                icon="waveform"
                label="Audio"
                onPress={() => setSheet('settings')}
                large
              />
            ) : null}
          </ScrollView>

          {segments.length ? (
            <>
              <Text style={styles.section}>Moments</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.rail}
              >
                {segments.map((s) => {
                  const on = current?.id === s.id;
                  return (
                    <Pressable
                      key={s.id}
                      onPress={() => {
                        seekTo(s.startSec - clipStart);
                        setPaused(false);
                      }}
                      accessibilityLabel={`${segmentLabel(s)}, ${formatDuration(s.startSec - clipStart)}`}
                      style={styles.moment}
                    >
                      <View style={[styles.momentThumb, on && styles.momentOn]}>
                        <Image
                          source={{ uri: client.frameUrl(video, s.startSec) }}
                          style={StyleSheet.absoluteFill}
                          resizeMethod="resize"
                        />
                        <Text style={styles.momentTime}>
                          {formatDuration(s.startSec - clipStart)}
                        </Text>
                      </View>
                      <Text
                        style={[styles.momentLabel, on && styles.momentLabelOn]}
                        numberOfLines={1}
                      >
                        {segmentLabel(s)}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          ) : null}

          {video.performers?.length ? (
            <>
              <Text style={styles.section}>People</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.people}
              >
                {video.performers.map((p) => (
                  <View key={p.id} style={styles.person}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{initials(p.name)}</Text>
                    </View>
                    <Text style={styles.personName} numberOfLines={2}>
                      {p.name}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </>
          ) : null}

          {upNext.length ? (
            <>
              <View style={styles.rule} />
              <View style={styles.upNextHead}>
                <Text style={styles.sectionInline}>Up next</Text>
                <Pressable
                  onPress={() => onAutoplay(!autoplay)}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: autoplay }}
                  style={styles.autoplay}
                >
                  <Text style={styles.autoplayText}>Autoplay</Text>
                  <View style={[styles.toggle, autoplay && styles.toggleOn]}>
                    <View style={[styles.knob, autoplay && styles.knobOn]} />
                  </View>
                </Pressable>
              </View>
              {upNext.slice(0, 8).map((v, i) => (
                <Pressable
                  key={v.id}
                  onPress={() => onPlayNext(v, upNext.slice(i + 1))}
                  style={({ pressed }) => [
                    styles.nextRow,
                    pressed && styles.pressedBg,
                  ]}
                >
                  <View style={styles.nextThumb}>
                    <Image
                      source={{ uri: client.imageUrl(v, 320) }}
                      style={StyleSheet.absoluteFill}
                      resizeMethod="resize"
                    />
                    <Text style={styles.nextDur}>
                      {formatDuration(primaryFile(v)?.duration)}
                    </Text>
                  </View>
                  <View style={styles.nextText}>
                    <Text style={styles.nextTitle} numberOfLines={2}>
                      {videoTitle(v)}
                    </Text>
                    {v.studioName ? (
                      <Text style={styles.nextSub} numberOfLines={1}>
                        {v.studioName}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </>
          ) : null}
          {details ? <Text style={styles.tech}>{details}</Text> : null}
        </ScrollView>
      ) : null}

      {tablet ? (
        <>
          <View
            style={[styles.mBack, { top: insets.top + 10, left: TABLET_PAD }]}
          >
            <Pressable
              onPress={onClose}
              accessibilityLabel="Back to the Library"
              style={styles.mBackButton}
            >
              <Icon name="caret-left" size={20} color={n.text} />
            </Pressable>
            <Text style={styles.mCrumb}>Library</Text>
          </View>
          <ScrollView
            style={[
              styles.mDetails,
              {
                top: tabletTop + tabletHeight + 16,
                bottom: barBottom,
                left: TABLET_PAD,
                width: tabletWidth,
              },
            ]}
            contentContainerStyle={styles.mDetailsContent}
          >
            <View style={styles.mTitleRow}>
              <View style={styles.mTitleBlock}>
                <Text style={styles.mTitle}>{videoTitle(video)}</Text>
                <Text style={styles.meta}>
                  {[
                    meta,
                    engagement?.playCount
                      ? `watched ${engagement.playCount}×`
                      : null,
                    engagement?.rating
                      ? `★ ${(Math.round(engagement.rating / 10) / 2).toFixed(1)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <View style={styles.mPills}>
                <Pill
                  icon="bookmark-simple"
                  fill={savedForLater}
                  on={savedForLater}
                  label={savedForLater ? 'Saved for later' : 'Save for later'}
                  onPress={toggleLater}
                  large
                />
                <Pill
                  icon="heart"
                  fill={!!engagement?.isFavorite}
                  on={!!engagement?.isFavorite}
                  label="Favorite"
                  onPress={toggleFavorite}
                  large
                />
                <Pill
                  icon="arrow-counter-clockwise"
                  label="Start over"
                  onPress={() => {
                    seekTo(0);
                    setPaused(false);
                  }}
                  large
                />
                {tracks.length > 1 ? (
                  <Pill
                    icon="waveform"
                    label="Audio"
                    onPress={() => setSheet('settings')}
                    large
                  />
                ) : null}
              </View>
            </View>
            {video.performers?.length || video.tags?.length ? (
              <View style={styles.mChips}>
                {(video.performers ?? []).map((p) => (
                  <View key={`p${p.id}`} style={styles.mPerson}>
                    <View style={styles.mAvatar}>
                      <Text style={styles.mAvatarText}>{initials(p.name)}</Text>
                    </View>
                    <Text style={styles.mChipText}>{p.name}</Text>
                  </View>
                ))}
                {(video.tags ?? []).map((t) => (
                  <View key={`t${t.id}`} style={styles.mTag}>
                    <Text style={styles.mChipText}>{t.name}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>
          <View style={[styles.mPanel, { bottom: barBottom }]}>
            <View style={[styles.mTabs, { marginTop: insets.top }]}>
              {(
                [
                  ['moments', 'Moments'],
                  ['next', 'Up next'],
                  ['details', 'Details'],
                ] as const
              ).map(([key, label]) => (
                <Pressable
                  key={key}
                  onPress={() => setPanelTab(key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: panelTab === key }}
                  style={[styles.mTab, panelTab === key && styles.mTabOn]}
                >
                  <Text
                    style={[
                      styles.mTabText,
                      panelTab === key && styles.mTabTextOn,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <ScrollView contentContainerStyle={styles.mPanelContent}>
              {panelTab === 'moments' ? (
                segments.length ? (
                  segments.map((sg) => {
                    const on = current?.id === sg.id;
                    return (
                      <Pressable
                        key={sg.id}
                        onPress={() => {
                          seekTo(sg.startSec - clipStart);
                          setPaused(false);
                        }}
                        style={({ pressed }) => [
                          styles.mMoment,
                          on && styles.mMomentOn,
                          pressed && styles.pressedBg,
                        ]}
                      >
                        <Image
                          source={{ uri: client.frameUrl(video, sg.startSec) }}
                          style={styles.mMomentThumb}
                          resizeMethod="resize"
                        />
                        <View style={styles.mMomentText}>
                          <Text
                            style={[
                              styles.mMomentLabel,
                              on && styles.momentLabelOn,
                            ]}
                            numberOfLines={2}
                          >
                            {segmentLabel(sg)}
                          </Text>
                          <Text style={styles.momentRowTime}>
                            {formatDuration(sg.startSec - clipStart)}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })
                ) : (
                  <Text style={styles.mEmpty}>This video has no moments.</Text>
                )
              ) : panelTab === 'next' ? (
                <>
                  <View style={styles.mNextHead}>
                    <Text style={styles.mNote}>
                      The Library&apos;s order, after this video
                    </Text>
                    <Pressable
                      onPress={() => onAutoplay(!autoplay)}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: autoplay }}
                      style={styles.autoplay}
                    >
                      <Text style={styles.autoplayText}>Autoplay</Text>
                      <View
                        style={[styles.toggle, autoplay && styles.toggleOn]}
                      >
                        <View
                          style={[styles.knob, autoplay && styles.knobOn]}
                        />
                      </View>
                    </Pressable>
                  </View>
                  {upNext.length ? (
                    upNext.slice(0, 20).map((v, i) => (
                      <Pressable
                        key={v.id}
                        onPress={() => onPlayNext(v, upNext.slice(i + 1))}
                        style={({ pressed }) => [
                          styles.mNext,
                          pressed && styles.pressedBg,
                        ]}
                      >
                        <View style={styles.nextThumb}>
                          <Image
                            source={{ uri: client.imageUrl(v, 320) }}
                            style={StyleSheet.absoluteFill}
                            resizeMethod="resize"
                          />
                          <Text style={styles.nextDur}>
                            {formatDuration(primaryFile(v)?.duration)}
                          </Text>
                        </View>
                        <View style={styles.nextText}>
                          <Text style={styles.nextTitle} numberOfLines={2}>
                            {videoTitle(v)}
                          </Text>
                          {v.studioName ? (
                            <Text style={styles.nextSub} numberOfLines={1}>
                              {v.studioName}
                            </Text>
                          ) : null}
                        </View>
                      </Pressable>
                    ))
                  ) : (
                    <Text style={styles.mEmpty}>Nothing after this video.</Text>
                  )}
                </>
              ) : (
                <View style={styles.mFacts}>
                  {[
                    [
                      'Rating',
                      engagement?.rating
                        ? `★ ${(Math.round(engagement.rating / 10) / 2).toFixed(1)}`
                        : 'Not rated',
                    ],
                    ['Date', video.date ? partialDate(video.date) : '—'],
                    ['Studio', video.studioName ?? '—'],
                    [
                      'Group',
                      video.groups?.[0]
                        ? video.groups[0].videoIndex != null
                          ? `${video.groups[0].name} · part ${video.groups[0].videoIndex + 1}`
                          : video.groups[0].name
                        : '—',
                    ],
                    [
                      'Watched',
                      [
                        engagement?.playCount
                          ? `${engagement.playCount} times`
                          : 'Not yet',
                        engagement?.resumeTime
                          ? `resumes at ${formatDuration(engagement.resumeTime)}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · '),
                    ],
                    ['File', details || '—'],
                  ].map(([k, v]) => (
                    <View key={k} style={styles.mFact}>
                      <Text style={styles.mFactKey}>{k}</Text>
                      <Text style={styles.mFactValue}>{v}</Text>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>
          </View>
        </>
      ) : null}

      {/* Settings: speed and audio track */}
      <Sheet visible={sheet === 'settings'} onClose={() => setSheet(null)}>
        <SheetHeading>Playback</SheetHeading>
        <SheetSection>Speed</SheetSection>
        <View style={styles.rateRow}>
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
            <Pressable
              key={r}
              onPress={() => setRate(r)}
              accessibilityState={{ selected: rate === r }}
              style={[styles.rateChip, rate === r && styles.rateChipOn]}
            >
              <Text
                style={[
                  styles.rateChipText,
                  rate === r && styles.rateChipTextOn,
                ]}
              >
                {r}×
              </Text>
            </Pressable>
          ))}
        </View>
        {tracks.length > 1 ? (
          <>
            <SheetSection>Audio</SheetSection>
            {tracks.map((t, i) => (
              <SheetRow
                key={t.index}
                icon="waveform"
                label={trackLabel(t, i)}
                checked={t.index === currentTrack}
                onPress={() => {
                  setAudioTrack(t.index);
                  setSheet(null);
                }}
              />
            ))}
          </>
        ) : null}
      </Sheet>

      {/* 1l's Moments pill: the moments as a list that seeks */}
      <Sheet visible={sheet === 'moments'} onClose={() => setSheet(null)}>
        <SheetHeading>Moments</SheetHeading>
        <View>
          {segments.map((s) => {
            const on = current?.id === s.id;
            return (
              <Pressable
                key={s.id}
                onPress={() => {
                  seekTo(s.startSec - clipStart);
                  setPaused(false);
                  setSheet(null);
                }}
                style={({ pressed }) => [
                  styles.momentRow,
                  on && styles.momentRowOn,
                  pressed && styles.pressedBg,
                ]}
              >
                <View style={styles.momentRowThumb}>
                  <Image
                    source={{ uri: client.frameUrl(video, s.startSec) }}
                    style={StyleSheet.absoluteFill}
                    resizeMethod="resize"
                  />
                </View>
                <Text
                  style={[styles.momentRowLabel, on && styles.momentLabelOn]}
                  numberOfLines={1}
                >
                  {segmentLabel(s)}
                </Text>
                <Text style={styles.momentRowTime}>
                  {formatDuration(s.startSec - clipStart)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </View>
  );
}

// The design's shades: dark at the edge, easing out to clear. One gradient (stacked strips of decreasing darkness
// showed seams wherever their edges fell between pixels, e.g. at 1.5x density).
const SHADE_HEIGHT = 144;
const SHADE_GRADIENT = `linear-gradient(to bottom, ${Array.from(
  { length: 9 },
  (_, i) =>
    `rgba(10,11,18,${(0.64 * (1 - i / 8) ** 1.6).toFixed(3)}) ${(i * 12.5).toFixed(1)}%`
).join(', ')})`;

function Shade({ edge }: { edge: 'top' | 'bottom' }) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.shade,
        edge === 'top' ? styles.shadeTop : styles.shadeBottom,
      ]}
    />
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/** A random v4 UUID (the playback session's id). */
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : 8 + (r % 4)).toString(16);
  });
}

function IconButton({
  icon,
  size,
  label,
  onPress,
}: {
  icon: IconName;
  size: number;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <Icon name={icon} size={size} color={INK} />
    </Pressable>
  );
}

function PlayButton({
  size,
  icon,
  onPress,
}: {
  size: number;
  icon: IconName;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={icon === 'pause' ? 'Pause' : 'Play'}
      style={({ pressed }) => [
        styles.play,
        { width: size, height: size, borderRadius: size / 2 },
        pressed && styles.pressed,
      ]}
    >
      <Icon name={icon} fill size={size * 0.44} color={INK} />
    </Pressable>
  );
}

function Pill({
  icon,
  label,
  onPress,
  on,
  fill,
  large,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  on?: boolean;
  fill?: boolean;
  large?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityState={on !== undefined ? { selected: on } : undefined}
      style={({ pressed }) => [
        styles.pill,
        large ? styles.pillLarge : styles.pillOver,
        on && styles.pillOn,
        pressed && styles.pressed,
      ]}
    >
      <Icon
        name={icon}
        fill={fill}
        size={large ? 15 : 14}
        color={on ? n.accent : large ? n.text : INK}
      />
      <Text
        style={[
          styles.pillText,
          large ? styles.pillTextLarge : styles.pillTextOver,
          on && styles.pillTextOn,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const SCRIM = 'rgba(10,11,18,0.72)';

const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: n.bg },
  box: {
    position: 'absolute',
    backgroundColor: '#000',
    zIndex: 1,
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  transport: { flexDirection: 'row', alignItems: 'center' },
  transportWide: { gap: 64 },
  transportNarrow: { gap: 36 },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  pressedBg: { backgroundColor: n.textAlpha(6) },
  play: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(14,15,24,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(233,233,237,0.35)',
  },
  // 1k
  kScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,11,18,0.42)',
  },
  kTop: {
    position: 'absolute',
    top: 6,
    left: 6,
    right: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  kBottom: {
    position: 'absolute',
    left: 14,
    right: 4,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  kTime: {
    color: INK,
    fontSize: 11,
    fontFamily: fonts.medium,
    fontVariant: ['tabular-nums'],
  },
  kTimeDim: { color: 'rgba(233,233,237,0.6)' },
  kTrack: { position: 'absolute', left: 0, right: 0, bottom: -16 },
  details: { flex: 1 },
  detailsContent: { paddingTop: 18, paddingBottom: 48 },
  pad: { paddingHorizontal: 20 },
  title: {
    color: n.text,
    fontSize: 21,
    lineHeight: 27,
    fontFamily: fonts.medium,
    marginBottom: 4,
  },
  meta: { color: n.textAlpha(55), fontSize: 12.5, fontFamily: fonts.regular },
  pills: { gap: 8, paddingHorizontal: 20, paddingTop: 14 },
  section: {
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 10,
    color: n.text,
    fontSize: 15,
    fontFamily: fonts.medium,
  },
  sectionInline: { color: n.text, fontSize: 15, fontFamily: fonts.medium },
  rail: { gap: 10, paddingHorizontal: 20 },
  moment: { width: 128, gap: 6 },
  momentThumb: {
    width: 128,
    height: 72,
    borderRadius: n.radiusMd,
    overflow: 'hidden',
    backgroundColor: n.surface,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  momentOn: { borderColor: n.accent },
  momentTime: {
    position: 'absolute',
    left: 5,
    bottom: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: SCRIM,
    color: INK,
    fontSize: 10.5,
    fontFamily: fonts.medium,
    fontVariant: ['tabular-nums'],
  },
  momentLabel: { color: n.text, fontSize: 12.5, fontFamily: fonts.regular },
  momentLabelOn: { color: n.accent300 },
  people: { gap: 16, paddingHorizontal: 20 },
  person: { width: 64, alignItems: 'center', gap: 6 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: n.accent800,
  },
  avatarText: { color: n.accent100, fontSize: 17, fontFamily: fonts.medium },
  personName: {
    color: n.text,
    fontSize: 11.5,
    lineHeight: 14,
    textAlign: 'center',
    fontFamily: fonts.regular,
  },
  rule: {
    height: 1,
    marginTop: 22,
    marginHorizontal: 24,
    backgroundColor: n.divider,
  },
  upNextHead: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  autoplay: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  autoplayText: {
    color: n.textAlpha(60),
    fontSize: 12,
    fontFamily: fonts.regular,
  },
  toggle: {
    width: 32,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    backgroundColor: n.neutral800,
    borderWidth: 1,
    borderColor: n.divider,
  },
  toggleOn: { backgroundColor: n.accentAlpha(30), borderColor: n.accent },
  knob: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginLeft: 2,
    backgroundColor: n.neutral300,
  },
  knobOn: { marginLeft: 14, backgroundColor: n.accent200 },
  nextRow: {
    paddingHorizontal: 20,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  nextThumb: {
    width: 120,
    height: 68,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: n.surface,
  },
  nextDur: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    paddingHorizontal: 4,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: SCRIM,
    color: INK,
    fontSize: 10,
    fontFamily: fonts.medium,
    fontVariant: ['tabular-nums'],
  },
  nextText: { flex: 1, minWidth: 0, gap: 2 },
  nextTitle: { color: n.text, fontSize: 14, fontFamily: fonts.medium },
  nextSub: { color: n.textAlpha(55), fontSize: 12, fontFamily: fonts.regular },
  tech: {
    paddingHorizontal: 20,
    paddingTop: 20,
    color: n.textAlpha(40),
    fontSize: 11.5,
    fontFamily: fonts.regular,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillLarge: { height: 38, paddingHorizontal: 14, borderColor: n.divider },
  pillOver: {
    height: 32,
    paddingHorizontal: 12,
    borderColor: 'rgba(233,233,237,0.3)',
  },
  pillOn: { borderColor: n.accent },
  pillText: { fontFamily: fonts.regular },
  pillTextLarge: { color: n.text, fontSize: 13 },
  pillTextOver: { color: INK, fontSize: 12 },
  pillTextOn: { color: n.accent },
  // 1m
  mBottom: { position: 'absolute', left: 20, right: 20, bottom: 12, gap: 2 },
  mBack: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mBackButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: n.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mCrumb: { color: n.textAlpha(60), fontSize: 13, fontFamily: fonts.regular },
  mDetails: { position: 'absolute', bottom: 0 },
  mDetailsContent: { paddingBottom: 32, gap: 14 },
  // The title and meta on the left, the buttons on the right of the same row (design 1m)
  mTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 20 },
  mTitleBlock: { flex: 1, minWidth: 0, gap: 4 },
  mTitle: {
    color: n.text,
    fontSize: 24,
    lineHeight: 30,
    fontFamily: fonts.medium,
  },
  mPills: { flexDirection: 'row', flexShrink: 0, gap: 8 },
  mChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  mPerson: {
    height: 30,
    paddingLeft: 3,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: n.divider,
  },
  mAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: n.accent800,
  },
  mAvatarText: { color: n.accent100, fontSize: 10.5, fontFamily: fonts.medium },
  mTag: {
    height: 30,
    paddingHorizontal: 11,
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: n.divider,
  },
  mChipText: { color: n.text, fontSize: 12.5, fontFamily: fonts.regular },
  mPanel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: PANEL,
    backgroundColor: '#1e202e',
  },
  mTabs: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 16 },
  mTab: {
    flex: 1,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: n.divider,
  },
  mTabOn: { borderBottomWidth: 2, borderBottomColor: n.accent },
  mTabText: {
    color: n.textAlpha(60),
    fontSize: 13.5,
    fontFamily: fonts.regular,
  },
  mTabTextOn: { color: n.accent },
  mPanelContent: { padding: 12, paddingBottom: 32, gap: 4 },
  mMoment: {
    padding: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: n.radiusMd,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  mMomentOn: { backgroundColor: n.accentAlpha(10), borderColor: n.accent },
  mMomentThumb: {
    width: 120,
    height: 67,
    borderRadius: 6,
    backgroundColor: n.bg,
  },
  mMomentText: { flex: 1, minWidth: 0, gap: 3 },
  mMomentLabel: { color: n.text, fontSize: 14, fontFamily: fonts.medium },
  mEmpty: {
    padding: 12,
    color: n.textAlpha(55),
    fontSize: 13,
    fontFamily: fonts.regular,
  },
  mNextHead: {
    paddingHorizontal: 8,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mNote: { color: n.textAlpha(60), fontSize: 12.5, fontFamily: fonts.regular },
  mNext: {
    padding: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: n.radiusMd,
  },
  mFacts: { padding: 8, gap: 10 },
  mFact: { flexDirection: 'row', gap: 12 },
  mFactKey: {
    width: 84,
    color: n.textAlpha(50),
    fontSize: 13,
    fontFamily: fonts.regular,
  },
  mFactValue: {
    flex: 1,
    color: n.text,
    fontSize: 13,
    fontFamily: fonts.regular,
  },
  // 1l
  shade: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: SHADE_HEIGHT,
    experimental_backgroundImage: SHADE_GRADIENT,
  },
  shadeTop: { top: 0 },
  // The same steps, the darkest at the bottom edge
  shadeBottom: { bottom: 0, transform: [{ scaleY: -1 }] },
  lTop: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lTitle: { flex: 1, minWidth: 0 },
  lTitleText: { color: INK, fontSize: 16, fontFamily: fonts.medium },
  lSub: { color: INK_DIM, fontSize: 12, fontFamily: fonts.regular },
  ratePill: {
    height: 32,
    paddingHorizontal: 10,
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(233,233,237,0.35)',
  },
  ratePillText: { color: INK, fontSize: 13, fontFamily: fonts.medium },
  lBottom: { position: 'absolute', gap: 2 },
  lFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  lTime: {
    color: INK,
    fontSize: 12,
    fontFamily: fonts.medium,
    fontVariant: ['tabular-nums'],
  },
  lTimeDim: { color: INK_DIM },
  spacer: { flex: 1 },
  unlock: {
    position: 'absolute',
    top: '50%',
    marginTop: -24,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(14,15,24,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(233,233,237,0.35)',
  },
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
  flashText: { color: INK, fontSize: 18, fontFamily: fonts.semiBold },
  error: {
    color: '#ff8a8a',
    textAlign: 'center',
    paddingHorizontal: 32,
    fontFamily: fonts.regular,
  },
  // Sheets
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
  momentRowThumb: {
    width: 96,
    height: 54,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: n.bg,
  },
  momentRowLabel: {
    flex: 1,
    color: n.text,
    fontSize: 14,
    fontFamily: fonts.regular,
  },
  momentRowTime: {
    color: n.accent300,
    fontSize: 12.5,
    fontFamily: fonts.medium,
    fontVariant: ['tabular-nums'],
  },
});
