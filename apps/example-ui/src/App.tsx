import { useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
} from 'react-native';
import {
  LibavVideoView,
  type LibavVideoViewHandle,
  type LoadEvent,
} from 'react-native-libav';

import { SAMPLES } from './samples';

function Button({
  title,
  onPress,
  active,
}: {
  title: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      style={[styles.button, active && styles.buttonActive]}
      onPress={onPress}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

// A horizontal bar showing value (0..1); press or drag to change it.
function Bar({
  value,
  onChange,
  onRelease,
  width,
}: {
  value: number;
  onChange: (value: number) => void;
  onRelease?: (value: number) => void;
  width?: number;
}) {
  const [barWidth, setBarWidth] = useState(1);
  const at = (e: GestureResponderEvent) =>
    Math.min(1, Math.max(0, e.nativeEvent.locationX / barWidth));
  return (
    <View
      style={[styles.bar, width ? { width } : styles.barFill]}
      onLayout={(e) => setBarWidth(Math.max(1, e.nativeEvent.layout.width))}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => onChange(at(e))}
      onResponderMove={(e) => onChange(at(e))}
      onResponderRelease={(e) => onRelease?.(at(e))}
    >
      <View
        pointerEvents="none"
        style={[
          styles.barValue,
          { width: `${Math.min(1, Math.max(0, value)) * 100}%` },
        ]}
      />
    </View>
  );
}

const HARDWARE_DECODER = Platform.OS === 'android' ? 'MediaCodec' : 'D3D11VA';

const format = (s: number) =>
  `${Math.floor(s / 60)}:${Math.floor(s % 60)
    .toString()
    .padStart(2, '0')}`;

export default function App() {
  const player = useRef<LibavVideoViewHandle>(null);
  const [source, setSource] = useState(SAMPLES[0]!);
  const [input, setInput] = useState(SAMPLES[0]!);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [loop, setLoop] = useState(true);
  const [hardware, setHardware] = useState(true);
  const [mounted, setMounted] = useState(true);
  const [audioTrack, setAudioTrack] = useState(-1);
  const [info, setInfo] = useState<LoadEvent | null>(null);
  const [time, setTime] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null); // seek bar position while dragging
  const [status, setStatus] = useState('');

  const duration = info?.duration ?? 0;
  const open = (s: string) => {
    setInput(s);
    setSource(s);
    setInfo(null);
    setAudioTrack(-1);
    setTime(0);
    setStatus('');
  };
  const seek = (seconds: number) => {
    const t = Math.min(Math.max(0, seconds), duration || seconds);
    setTime(t);
    player.current?.seek(t);
  };

  return (
    <View style={styles.container}>
      <View style={styles.video}>
        {mounted && (
          <LibavVideoView
            ref={player}
            style={StyleSheet.absoluteFill}
            source={source}
            paused={paused}
            muted={muted}
            volume={volume}
            loop={loop}
            hardwareDecoding={hardware}
            audioTrack={audioTrack}
            onLoad={(e) => {
              setInfo(e.nativeEvent);
              setStatus('playing');
            }}
            onProgress={(e) => {
              if (scrub === null) setTime(e.nativeEvent.currentTime);
            }}
            onSeek={(e) => {
              setTime(e.nativeEvent.currentTime);
              setStatus(`seeked to ${format(e.nativeEvent.currentTime)}`);
            }}
            onEnd={() => setStatus('ended')}
            onError={(e) => setStatus(`error: ${e.nativeEvent.message}`)}
          />
        )}
      </View>

      <View style={styles.row}>
        <Text style={styles.time}>{format(scrub ?? time)}</Text>
        <Bar
          value={duration ? (scrub ?? time) / duration : 0}
          onChange={(v) => setScrub(v * duration)}
          onRelease={(v) => {
            setScrub(null);
            seek(v * duration);
          }}
        />
        <Text style={styles.time}>{format(duration)}</Text>
      </View>

      <View style={styles.row}>
        <Button title="−10s" onPress={() => seek(time - 10)} />
        <Button
          title={paused ? 'Play' : 'Pause'}
          onPress={() => setPaused(!paused)}
        />
        <Button title="+10s" onPress={() => seek(time + 10)} />
        <Button title="⏮" onPress={() => seek(0)} />
        <Button
          title={muted ? 'Unmute' : 'Mute'}
          onPress={() => setMuted(!muted)}
        />
        <Text style={styles.label}>Volume</Text>
        <Bar value={volume} onChange={setVolume} width={140} />
        <Text style={styles.label}>{Math.round(volume * 100)}%</Text>
      </View>

      {info && info.audioTracks.length > 0 && (
        <View style={styles.row}>
          <Text style={styles.label}>Audio</Text>
          {info.audioTracks.map((t) => (
            <Button
              key={t.index}
              active={
                (audioTrack === -1 ? info.audioTrack : audioTrack) === t.index
              }
              title={[
                `#${t.index}`,
                t.language,
                t.title,
                `${t.codec} ${t.channels}ch`,
              ]
                .filter(Boolean)
                .join(' · ')}
              onPress={() => setAudioTrack(t.index)}
            />
          ))}
        </View>
      )}

      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => open(input)}
          placeholder="File path or URL"
        />
        <Button title="Open" onPress={() => open(input)} />
      </View>
      <View style={styles.row}>
        {SAMPLES.map((s) => (
          <Button
            key={s}
            title={s.split('/').pop()!}
            active={s === source}
            onPress={() => open(s)}
          />
        ))}
      </View>
      <View style={styles.row}>
        <Button
          title={loop ? 'Loop: on' : 'Loop: off'}
          onPress={() => setLoop(!loop)}
        />
        <Button
          title={hardware ? 'HW decode: on' : 'HW decode: off'}
          onPress={() => setHardware(!hardware)}
        />
        <Button
          title={mounted ? 'Unmount' : 'Mount'}
          onPress={() => setMounted(!mounted)}
        />
      </View>
      <Text style={styles.status}>
        {info
          ? `${info.codec} ${info.width}x${info.height}` +
            ` · ${info.hwDecoding ? HARDWARE_DECODER : 'software'} decode` +
            (info.hasAudio
              ? ` · ${info.audioTracks.length} audio track(s)`
              : ' · no audio')
          : ''}
        {status ? ` · ${status}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 12,
    gap: 8,
    backgroundColor: '#111',
    // Android 15 draws edge to edge: keep clear of the status and navigation bars.
    ...(Platform.OS === 'android' && { paddingTop: 40, paddingBottom: 56 }),
  },
  video: { flex: 1, backgroundColor: '#000' },
  row: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    color: '#fff',
    borderColor: '#555',
    borderWidth: 1,
    paddingHorizontal: 8,
  },
  button: {
    backgroundColor: '#333',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  buttonActive: { backgroundColor: '#2b5797' },
  buttonText: { color: '#fff' },
  bar: {
    height: 14,
    backgroundColor: '#333',
    borderRadius: 7,
    overflow: 'hidden',
  },
  barFill: { flex: 1 },
  barValue: { height: '100%', backgroundColor: '#4a90e2' },
  time: { color: '#ccc', width: 44, textAlign: 'center' },
  label: { color: '#ccc' },
  status: { color: '#ccc' },
});
