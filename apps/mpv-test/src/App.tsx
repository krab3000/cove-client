import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  MpvVideoView,
  clearHttpCache,
  getHttpCacheStats,
  onHttpAuthorizationNeeded,
  prefetchMedia,
  setHttpAuthorization,
  type AudioTrack,
  type SubtitleTrack,
  type HttpCacheStats,
  type MpvVideoViewHandle,
} from 'react-native-mpv';

const DEFAULT_URL =
  'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_1MB.mp4';
const SPEEDS = [0.5, 1, 1.5, 2];

// scheme://host:port of a URL, the key setHttpAuthorization takes.
function serverOf(url: string): string | null {
  const m = /^(https?):\/\/([^/?#]+)/i.exec(url.trim());
  if (!m) return null;
  const [, scheme, host] = m;
  const lower = scheme!.toLowerCase();
  return host!.includes(':')
    ? `${lower}://${host}`
    : `${lower}://${host}:${lower === 'https' ? 443 : 80}`;
}

const time = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

export default function App() {
  const player = useRef<MpvVideoViewHandle>(null);
  const progressed = useRef(false);
  const [url, setUrl] = useState(DEFAULT_URL);
  const [auth, setAuth] = useState('');
  const [source, setSource] = useState<string | undefined>();
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [loop, setLoop] = useState(false);
  const [hardwareDecoding, setHardwareDecoding] = useState(true);
  const [rate, setRate] = useState(1);
  const [cache, setCache] = useState(false);
  const [tracks, setTracks] = useState<readonly AudioTrack[]>([]);
  const [audioTrack, setAudioTrack] = useState(-1);
  const [subtitleTracks, setSubtitleTracks] = useState<
    readonly SubtitleTrack[]
  >([]);
  const [subtitleTrack, setSubtitleTrack] = useState(-1);
  const [position, setPosition] = useState({ current: 0, duration: 0 });
  const [seekTo, setSeekTo] = useState('');
  const [stats, setStats] = useState<HttpCacheStats | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const note = useCallback((line: string) => {
    const now = new Date().toISOString().slice(11, 23);
    setLog((l) => [`${now} ${line}`, ...l].slice(0, 200));
  }, []);

  useEffect(
    () =>
      onHttpAuthorizationNeeded((server) =>
        note(`401 from ${server}: paste a fresh header and press Open`)
      ),
    [note]
  );

  const open = () => {
    const server = serverOf(url);
    if (server) setHttpAuthorization(server, auth.trim() || null);
    setTracks([]);
    setAudioTrack(-1);
    setSubtitleTracks([]);
    setPosition({ current: 0, duration: 0 });
    progressed.current = false;
    setPaused(false);
    // A new string reopens even when the URL is the same.
    setSource(source === url.trim() ? `${url.trim()}#` : url.trim());
    note(`open ${url.trim()}`);
  };

  const seek = (seconds: number) => {
    const target = Math.max(0, seconds);
    player.current?.seek(target);
    note(`seek ${time(target)}`);
  };

  const refreshStats = async () => setStats(await getHttpCacheStats());

  return (
    <View style={styles.root}>
      <View style={styles.video}>
        {source ? (
          <MpvVideoView
            ref={player}
            style={StyleSheet.absoluteFill}
            source={source}
            paused={paused}
            muted={muted}
            volume={volume}
            loop={loop}
            rate={rate}
            hardwareDecoding={hardwareDecoding}
            audioTrack={audioTrack}
            subtitleTrack={subtitleTrack}
            cache={cache}
            onLoad={({ nativeEvent: e }) => {
              setTracks(e.audioTracks);
              setSubtitleTracks(e.subtitleTracks);
              note(
                `load ${e.width}x${e.height} ${e.codec} ${e.hwDecoding ? 'hw' : 'sw'}, ${time(e.duration)}, ` +
                  `audio ${e.hasAudio ? `#${e.audioTrack} (${e.audioTracks.length} tracks)` : 'none'}, ` +
                  `subtitles ${e.subtitleTracks.length ? `#${e.subtitleTrack} (${e.subtitleTracks.length} tracks)` : 'none'}`
              );
            }}
            onProgress={({ nativeEvent: e }) => {
              if (!progressed.current) {
                progressed.current = true;
                note(`first frame at ${time(e.currentTime)}`);
              }
              setPosition({ current: e.currentTime, duration: e.duration });
            }}
            onSeek={({ nativeEvent: e }) =>
              note(`seek done at ${time(e.currentTime)}`)
            }
            onEnd={() => note('end')}
            onError={({ nativeEvent: e }) => note(`error: ${e.message}`)}
          />
        ) : (
          <Text style={styles.placeholder}>Paste a URL and press Open</Text>
        )}
      </View>

      <ScrollView
        style={styles.panel}
        contentContainerStyle={styles.panelContent}
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          placeholder="URL, path or content:// URI"
          placeholderTextColor="#777"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          value={auth}
          onChangeText={setAuth}
          placeholder="Authorization header (Bearer …), optional"
          placeholderTextColor="#777"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Row>
          <Button label="Open" onPress={open} />
          <Button
            label="Close"
            onPress={() => {
              setSource(undefined);
              note('close');
            }}
          />
          <Toggle
            label="cache (whole file)"
            value={cache}
            onChange={setCache}
          />
        </Row>

        <Text style={styles.time}>
          {time(position.current)} / {time(position.duration)}
        </Text>
        <Row>
          <Button
            label={paused ? 'Play' : 'Pause'}
            onPress={() => setPaused((p) => !p)}
          />
          <Button label="−10 s" onPress={() => seek(position.current - 10)} />
          <Button label="+10 s" onPress={() => seek(position.current + 10)} />
          <TextInput
            style={[styles.input, styles.seekInput]}
            value={seekTo}
            onChangeText={setSeekTo}
            placeholder="s"
            placeholderTextColor="#777"
            keyboardType="numeric"
          />
          <Button
            label="Seek"
            onPress={() => {
              const s = Number(seekTo);
              if (Number.isFinite(s)) seek(s);
            }}
          />
        </Row>
        <Row>
          <Toggle label="mute" value={muted} onChange={setMuted} />
          <Toggle label="loop" value={loop} onChange={setLoop} />
          <Toggle
            label="hw decoding"
            value={hardwareDecoding}
            onChange={setHardwareDecoding}
          />
        </Row>
        <Row>
          <Text style={styles.label}>volume</Text>
          {[0, 0.25, 0.5, 1].map((v) => (
            <Choice
              key={v}
              label={`${v * 100}%`}
              selected={volume === v}
              onPress={() => setVolume(v)}
            />
          ))}
        </Row>
        <Row>
          <Text style={styles.label}>speed</Text>
          {SPEEDS.map((s) => (
            <Choice
              key={s}
              label={`${s}×`}
              selected={rate === s}
              onPress={() => setRate(s)}
            />
          ))}
        </Row>
        {tracks.length > 0 && (
          <Row>
            <Text style={styles.label}>audio</Text>
            <Choice
              label="default"
              selected={audioTrack === -1}
              onPress={() => setAudioTrack(-1)}
            />
            {tracks.map((t) => (
              <Choice
                key={t.index}
                label={`${t.index}: ${t.title || t.language || t.codec} ${t.channels}ch`}
                selected={audioTrack === t.index}
                onPress={() => setAudioTrack(t.index)}
              />
            ))}
          </Row>
        )}
        {subtitleTracks.length > 0 && (
          <Row>
            <Text style={styles.label}>subtitles</Text>
            <Choice
              label="off"
              selected={subtitleTrack === -2}
              onPress={() => setSubtitleTrack(-2)}
            />
            <Choice
              label="default"
              selected={subtitleTrack === -1}
              onPress={() => setSubtitleTrack(-1)}
            />
            {subtitleTracks.map((t) => (
              <Choice
                key={t.index}
                label={`${t.index}: ${t.title || t.language || t.codec} (${t.codec})${t.isDefault ? ' ★' : ''}`}
                selected={subtitleTrack === t.index}
                onPress={() => setSubtitleTrack(t.index)}
              />
            ))}
          </Row>
        )}

        <Row>
          <Button label="Cache stats" onPress={refreshStats} />
          <Button
            label="Clear cache"
            onPress={() => {
              clearHttpCache();
              note('cache cleared');
              refreshStats();
            }}
          />
          <Button
            label="Prefetch URL"
            onPress={() => {
              prefetchMedia([url.trim()]);
              note(`prefetch ${url.trim()}`);
            }}
          />
        </Row>
        {stats && (
          <Text style={styles.mono}>
            RAM {mb(stats.ramBytes)} / {mb(stats.ramLimit)} ({stats.ramChunks}{' '}
            chunks of {mb(stats.chunkSize)}), disk{' '}
            {stats.disk.enabled
              ? `${mb(stats.disk.bytes)} / ${mb(stats.disk.limit)} (${stats.disk.chunks} chunks, ${stats.disk.reads} reads)`
              : 'off'}
            {'\n'}fetches {stats.fetches} ({mb(stats.fetchedBytes)},{' '}
            {stats.fetchMs} ms), in flight {stats.inFlight}, failed{' '}
            {stats.failed}
          </Text>
        )}

        <Text style={styles.label}>events</Text>
        {log.map((line, i) => (
          <Text key={log.length - i} style={styles.mono}>
            {line}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.button} onPress={onPress}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Choice
      label={`${value ? '☑' : '☐'} ${label}`}
      selected={value}
      onPress={() => onChange(!value)}
    />
  );
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.choice, selected && styles.choiceSelected]}
      onPress={onPress}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111' },
  video: {
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: { color: '#888' },
  panel: { flex: 1 },
  panelContent: { padding: 12, gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 6,
    color: '#eee',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  seekInput: { width: 70 },
  button: {
    backgroundColor: '#2d5bd7',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  choice: {
    borderWidth: 1,
    borderColor: '#555',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  choiceSelected: { borderColor: '#2d5bd7', backgroundColor: '#1d2c55' },
  buttonText: { color: '#fff' },
  label: { color: '#aaa', marginRight: 4 },
  time: { color: '#eee', fontVariant: ['tabular-nums'] },
  mono: { color: '#ccc', fontFamily: 'monospace', fontSize: 11 },
});
