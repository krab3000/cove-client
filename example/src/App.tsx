import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LibavVideoView, type LoadEvent } from 'react-native-libav';

// Test clips made by example/scripts/make-test-media.ps1.
const MEDIA = 'D:/dev/cove/react-native-libav/example/assets/media';
const SAMPLES = [
  `${MEDIA}/h264-1080p.mp4`,
  `${MEDIA}/hevc10-2160p.mp4`,
  `${MEDIA}/av1-1080p.mkv`,
];

function Button({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable style={styles.button} onPress={onPress}>
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

export default function App() {
  const [source, setSource] = useState(SAMPLES[0]!);
  const [input, setInput] = useState(SAMPLES[0]!);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(true);
  const [hardware, setHardware] = useState(true);
  const [mounted, setMounted] = useState(true);
  const [info, setInfo] = useState<LoadEvent | null>(null);
  const [time, setTime] = useState(0);
  const [status, setStatus] = useState('');

  const open = (s: string) => {
    setInput(s);
    setSource(s);
    setInfo(null);
    setStatus('');
  };

  return (
    <View style={styles.container}>
      <View style={styles.video}>
        {mounted && (
          <LibavVideoView
            style={StyleSheet.absoluteFill}
            source={source}
            paused={paused}
            muted={muted}
            loop={loop}
            hardwareDecoding={hardware}
            onLoad={(e) => {
              setInfo(e.nativeEvent);
              setStatus('playing');
            }}
            onProgress={(e) => setTime(e.nativeEvent.currentTime)}
            onEnd={() => setStatus('ended')}
            onError={(e) => setStatus(`error: ${e.nativeEvent.message}`)}
          />
        )}
      </View>

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
            onPress={() => open(s)}
          />
        ))}
      </View>
      <View style={styles.row}>
        <Button
          title={paused ? 'Play' : 'Pause'}
          onPress={() => setPaused(!paused)}
        />
        <Button
          title={muted ? 'Unmute' : 'Mute'}
          onPress={() => setMuted(!muted)}
        />
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
        {time.toFixed(1)}s
        {info
          ? ` / ${info.duration.toFixed(1)}s · ${info.codec} ${info.width}x${info.height}` +
            ` · ${info.hwDecoding ? 'D3D11VA' : 'software'} decode` +
            (info.hasAudio ? ' · audio' : '')
          : ''}
        {status ? ` · ${status}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12, gap: 8, backgroundColor: '#111' },
  video: { flex: 1, backgroundColor: '#000' },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
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
  buttonText: { color: '#fff' },
  status: { color: '#ccc' },
});
