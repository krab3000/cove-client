import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  NativeModules,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TurboModuleRegistry,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import {
  VlcVideoView,
  type LoadEvent,
  type VlcVideoViewHandle,
} from 'react-native-vlc';

type FilePickerModule = { pickFile(): Promise<string> };
// windows/VlcTest/FilePicker.h
const FilePicker: FilePickerModule | null =
  (TurboModuleRegistry.get('FilePicker') as FilePickerModule | null) ??
  (NativeModules.FilePicker as FilePickerModule | undefined) ??
  null;

const MEDIA = 'D:/dev/cove/react-native-libav/media';
const SAMPLES = [
  `${MEDIA}/h264-1080p.mp4`,
  `${MEDIA}/hevc10-2160p.mp4`,
  `${MEDIA}/av1-1080p.mkv`,
  `${MEDIA}/multi-audio.mkv`,
  `${MEDIA}/sidecar-subs.mp4`,
  `${MEDIA}/hdr10-test.mp4`,
  'D:/dev/cove/remote-heavylifter/local-test/.downloads/Sintel.2010.1080p.mkv',
];

const SUBTITLES_DEFAULT = -1; // VLC's choice
const SUBTITLES_OFF = -2;

/** 75 -> "1:15", 3725 -> "1:02:05" */
function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function trackLabel(
  i: number,
  t: { language: string; title: string; codec: string }
) {
  return [`#${i + 1}`, t.title, t.language, t.codec]
    .filter(Boolean)
    .join(' · ');
}

export default function App() {
  const player = useRef<VlcVideoViewHandle>(null);
  const [input, setInput] = useState('');
  const [source, setSource] = useState('');
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [loop, setLoop] = useState(false);
  const [hardware, setHardware] = useState(true);
  const [audioTrack, setAudioTrack] = useState(-1);
  const [subtitleTrack, setSubtitleTrack] = useState(SUBTITLES_DEFAULT);
  const [info, setInfo] = useState<LoadEvent | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ended, setEnded] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [barWidth, setBarWidth] = useState(1);

  const addLog = useCallback((line: string) => {
    const stamp = new Date().toISOString().slice(11, 23);
    setLog((l) => [`${stamp}  ${line}`, ...l].slice(0, 40));
  }, []);

  const open = useCallback(
    (path: string) => {
      const p = path.trim().replace(/^"(.*)"$/, '$1');
      if (!p) return;
      setInput(p);
      setSource(p);
      setInfo(null);
      setTime(0);
      setDuration(0);
      setEnded(false);
      setPaused(false);
      setAudioTrack(-1);
      setSubtitleTrack(SUBTITLES_DEFAULT);
      addLog(`open ${p}`);
    },
    [addLog]
  );

  const pick = useCallback(async () => {
    if (!FilePicker) {
      addLog('FilePicker native module is missing');
      return;
    }
    try {
      const path = await FilePicker.pickFile();
      if (path) open(path);
    } catch (e) {
      addLog(`file picker failed: ${String(e)}`);
    }
  }, [addLog, open]);

  const seek = (seconds: number) => {
    const target = Math.max(0, duration ? Math.min(seconds, duration) : seconds);
    setTime(target);
    setEnded(false);
    player.current?.seek(target);
    addLog(`seek to ${formatTime(target)}`);
  };

  const onBarPress = (e: GestureResponderEvent) => {
    if (duration > 0)
      seek((e.nativeEvent.locationX / barWidth) * duration);
  };

  const progress = duration > 0 ? Math.min(1, time / duration) : 0;

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <Button label="Open file…" onPress={pick} primary />
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => open(input)}
          placeholder="A file path or URL (https://, rtsp://, …)"
          placeholderTextColor="#777"
        />
        <Button label="Open" onPress={() => open(input)} />
      </View>
      <ScrollView
        horizontal
        style={styles.samples}
        contentContainerStyle={styles.samplesContent}
      >
        {SAMPLES.map((s) => (
          <Chip
            key={s}
            label={fileName(s)}
            selected={s === source}
            onPress={() => open(s)}
          />
        ))}
      </ScrollView>

      <View style={styles.video}>
        {source ? (
          <VlcVideoView
            ref={player}
            style={StyleSheet.absoluteFill}
            source={source}
            paused={paused}
            muted={muted}
            volume={volume}
            loop={loop}
            hardwareDecoding={hardware}
            audioTrack={audioTrack}
            subtitleTrack={subtitleTrack}
            onLoad={(e) => {
              const i = e.nativeEvent;
              setInfo(i);
              setDuration(i.duration);
              addLog(
                `load ${i.width}x${i.height} ${i.codec} ${formatTime(i.duration)}, ` +
                  `${i.audioTracks.length} audio (playing ${i.audioTrack}), ` +
                  `${i.subtitleTracks.length} subtitles (showing ${i.subtitleTrack})`
              );
            }}
            onProgress={(e) => {
              setTime(e.nativeEvent.currentTime);
              if (e.nativeEvent.duration) setDuration(e.nativeEvent.duration);
            }}
            onSeek={(e) =>
              addLog(`seeked: ${formatTime(e.nativeEvent.currentTime)} on screen`)
            }
            onEnd={() => {
              setEnded(true);
              setPaused(true);
              addLog('end');
            }}
            onError={(e) => addLog(`error: ${e.nativeEvent.message}`)}
          />
        ) : (
          <Text style={styles.placeholder}>
            Open a file, type a path or URL, or pick a sample above
          </Text>
        )}
      </View>

      <View style={styles.seekRow}>
        <Text style={styles.time}>{formatTime(time)}</Text>
        <Pressable
          style={styles.bar}
          onPress={onBarPress}
          onLayout={(e: LayoutChangeEvent) =>
            setBarWidth(Math.max(1, e.nativeEvent.layout.width))
          }
        >
          <View style={[styles.barFill, { width: `${progress * 100}%` }]} />
        </Pressable>
        <Text style={styles.time}>{formatTime(duration)}</Text>
      </View>

      <View style={styles.row}>
        <Button
          label={paused ? (ended ? 'Replay' : 'Play') : 'Pause'}
          onPress={() => {
            if (ended) setEnded(false);
            setPaused((p) => !p);
          }}
          primary
        />
        <Button label="−10 s" onPress={() => seek(time - 10)} />
        <Button label="+10 s" onPress={() => seek(time + 10)} />
        <Button label="Start" onPress={() => seek(0)} />
        <Spacer />
        <Button label={muted ? 'Unmute' : 'Mute'} onPress={() => setMuted((m) => !m)} />
        <Button
          label="Vol −"
          onPress={() => setVolume((v) => Math.max(0, Math.round((v - 0.1) * 10) / 10))}
        />
        <Text style={styles.value}>{Math.round(volume * 100)}%</Text>
        <Button
          label="Vol +"
          onPress={() => setVolume((v) => Math.min(1, Math.round((v + 0.1) * 10) / 10))}
        />
        <Spacer />
        <Chip label="Loop" selected={loop} onPress={() => setLoop((l) => !l)} />
        <Chip
          label={hardware ? 'HW decoding' : 'SW decoding'}
          selected={hardware}
          onPress={() => setHardware((h) => !h)}
        />
      </View>

      <TrackRow title="Audio">
        {info?.audioTracks.length ? (
          info.audioTracks.map((t, i) => (
            <Chip
              key={i}
              label={trackLabel(i, t) + (t.channels ? ` · ${t.channels} ch` : '')}
              selected={audioTrack === -1 ? info.audioTrack === i : audioTrack === i}
              onPress={() => {
                setAudioTrack(i);
                addLog(`audio track ${i}`);
              }}
            />
          ))
        ) : (
          <Text style={styles.dim}>{info ? 'none' : '—'}</Text>
        )}
      </TrackRow>

      <TrackRow title="Subtitles">
        <Chip
          label="Default"
          selected={subtitleTrack === SUBTITLES_DEFAULT}
          onPress={() => {
            setSubtitleTrack(SUBTITLES_DEFAULT);
            addLog('subtitles: VLC default');
          }}
        />
        <Chip
          label="Off"
          selected={subtitleTrack === SUBTITLES_OFF}
          onPress={() => {
            setSubtitleTrack(SUBTITLES_OFF);
            addLog('subtitles off');
          }}
        />
        {info?.subtitleTracks.map((t, i) => (
          <Chip
            key={i}
            label={trackLabel(i, t)}
            selected={subtitleTrack === i}
            onPress={() => {
              setSubtitleTrack(i);
              addLog(`subtitle track ${i}`);
            }}
          />
        ))}
        {info && !info.subtitleTracks.length ? (
          <Text style={styles.dim}>no subtitle tracks</Text>
        ) : null}
      </TrackRow>

      <Text style={styles.info} numberOfLines={1}>
        {info
          ? `${info.codec} ${info.width}×${info.height} · ${info.hwDecoding ? 'hardware decoding allowed' : 'software decoding'} · ` +
            `${info.hasAudio ? 'audio' : 'no audio'} · ${formatTime(info.duration)}`
          : source
            ? `loading ${fileName(source)}…`
            : ''}
      </Text>
      <ScrollView style={styles.log}>
        {log.map((line, i) => (
          <Text key={i} style={styles.logLine} selectable>
            {line}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

function Button({
  label,
  onPress,
  primary,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

function TrackRow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.trackRow}>
      <Text style={styles.trackTitle}>{title}</Text>
      <View style={styles.trackChips}>
        {children}
      </View>
    </View>
  );
}

function Spacer() {
  return <View style={styles.spacer} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111317', padding: 12, gap: 8 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#1d2027',
    color: '#eee',
    borderWidth: 1,
    borderColor: '#2c3039',
  },
  samples: { flexGrow: 0 },
  samplesContent: { gap: 6 },
  video: {
    flex: 1,
    minHeight: 200,
    backgroundColor: '#000',
    borderRadius: 6,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: { color: '#888' },
  seekRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  time: { color: '#ccc', width: 64, textAlign: 'center' },
  bar: {
    flex: 1,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#2a2e37',
    overflow: 'hidden',
  },
  barFill: { height: '100%', backgroundColor: '#4f8cff' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  spacer: { width: 12 },
  value: { color: '#ccc', width: 44, textAlign: 'center' },
  button: {
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 6,
    backgroundColor: '#2a2e37',
    justifyContent: 'center',
  },
  buttonPrimary: { backgroundColor: '#3a68c9' },
  buttonText: { color: '#fff' },
  pressed: { opacity: 0.6 },
  chip: {
    paddingHorizontal: 10,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#3a3f4a',
    justifyContent: 'center',
  },
  chipSelected: { backgroundColor: '#4f8cff', borderColor: '#4f8cff' },
  chipText: { color: '#ccc' },
  chipTextSelected: { color: '#fff' },
  trackRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  trackTitle: { color: '#999', width: 72, lineHeight: 30 },
  trackChips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  dim: { color: '#777' },
  info: { color: '#aaa' },
  log: {
    height: 110,
    flexGrow: 0,
    backgroundColor: '#0b0c0f',
    borderRadius: 6,
    padding: 6,
  },
  logLine: { color: '#9fb0c8', fontFamily: 'Consolas', fontSize: 12 },
});
