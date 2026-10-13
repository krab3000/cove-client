import { Platform } from 'react-native';
import type { IconName } from '../../ui/Icon';
import type { Prefs } from '../../state/prefs';

// The device's settings (design turn 7) as data: the sections, their rows, each row's choices. The phone's page,
// the tablet's panes and the player's Playback sheet all draw from it.

type KeyOf<V> = {
  [K in keyof Prefs]: Prefs[K] extends V ? K : never;
}[keyof Prefs];

export interface Option<T> {
  value: T;
  label: string;
}

export type Row =
  // A switch: the whole row toggles it
  | {
      kind: 'switch';
      key: KeyOf<boolean>;
      label: string;
      detail: string;
      tag?: string;
    }
  // A few short options, side by side
  | {
      kind: 'segments';
      key: keyof Prefs;
      label: string;
      detail: string;
      options: Option<string | number>[];
    }
  // A value: the row shows it, a sheet (phone) or a dialog (tablet) lists the choices
  | {
      kind: 'choice';
      key: KeyOf<number>;
      label: string;
      detail: string;
      // The sheet's sentence on what it changes
      explain: string;
      options: Option<number>[];
    }
  // What the HTTP cache holds, and Clear cache
  | { kind: 'usage' }
  // The app and this device
  | { kind: 'about' }
  | { kind: 'reset' };

export interface Section {
  title: string;
  icon: IconName;
  description: string;
  rows: Row[];
}

const android = Platform.OS === 'android';

export const SECTIONS: Section[] = [
  {
    title: 'Playback',
    icon: 'play-circle',
    description: 'How videos play, on this device.',
    rows: [
      {
        kind: 'switch',
        key: 'autoplay',
        label: 'Autoplay next',
        detail: 'When a video ends, play the next one in Up next.',
      },
      {
        kind: 'switch',
        key: 'resume',
        label: 'Resume where you left off',
        detail:
          'From where Cove saved it — unless that was the first seconds or the last 15.',
      },
      {
        kind: 'choice',
        key: 'seekStep',
        label: 'Skip step',
        detail: 'The skip buttons, and a double tap on either side',
        explain:
          'How far the skip buttons, and a double tap on either side of the video, jump.',
        options: [5, 10, 15, 30].map((s) => ({ value: s, label: `${s} s` })),
      },
      {
        kind: 'choice',
        key: 'hideAfterMs',
        label: 'Hide controls after',
        detail: 'Without a touch, while playing',
        explain:
          'How long the player’s controls stay up after the last touch. Paused, they stay.',
        options: [
          { value: 2000, label: '2 s' },
          { value: 3000, label: '3 s' },
          { value: 5000, label: '5 s' },
          { value: 0, label: 'Never' },
        ],
      },
      {
        kind: 'segments',
        key: 'subtitles',
        label: 'Subtitles',
        detail:
          'A video’s own default track, or none. Pick another track in the player.',
        options: [
          { value: 'file', label: 'As the file says' },
          { value: 'off', label: 'Off' },
        ],
      },
      {
        kind: 'switch',
        key: 'hardwareDecoding',
        label: 'Hardware decoding',
        detail:
          'Smoother, and easier on the battery. Turn it off if a video plays black, green or blocky.',
      },
    ],
  },
  {
    title: 'Library & previews',
    icon: 'squares-four',
    description:
      'The Library’s view, and what a card plays when you rest on it.',
    rows: [
      {
        kind: 'segments',
        key: 'libraryView',
        label: 'Library view',
        detail: 'Also follows the switch in the Library’s toolbar.',
        options: [
          { value: 'grid2', label: '2 columns' },
          { value: 'grid3', label: '3 columns' },
          { value: 'list', label: 'List' },
        ],
      },
      {
        kind: 'segments',
        key: 'previews',
        label: 'Previews',
        detail: 'The preview clip Cove made for a video, or nothing.',
        options: [
          { value: 'clip', label: 'Clip' },
          { value: 'off', label: 'Off' },
        ],
      },
      {
        kind: 'choice',
        key: 'preloadRows',
        label: 'Preload previews',
        detail: 'Rows ahead of where you scroll',
        explain:
          'Preview clips fetched for the rows you’re about to reach, so they start at once. More rows use more data.',
        options: [
          { value: 0, label: 'Off' },
          { value: 1, label: '1 row' },
          { value: 3, label: '3 rows' },
          { value: 6, label: '6 rows' },
        ],
      },
      {
        kind: 'switch',
        key: 'previewHardware',
        label: 'Decode previews in hardware',
        detail:
          'Turn off if previews stay black: some devices run out of decoders with several clips at once.',
      },
    ],
  },
  {
    title: 'Streaming & cache',
    icon: 'cloud-arrow-down',
    description:
      'How the player fetches video from your server, and what it keeps.',
    rows: [
      { kind: 'usage' },
      {
        kind: 'choice',
        key: 'memoryCacheMB',
        label: 'Memory cache',
        detail: 'Video held in memory ahead of the playhead',
        explain:
          'Video kept in memory ahead of what’s playing. Auto sizes it from this device’s memory, from 8 to 64 MB.',
        options: [
          { value: -1, label: 'Auto' },
          ...[16, 32, 64, 128].map((m) => ({ value: m, label: `${m} MB` })),
        ],
      },
      {
        kind: 'choice',
        key: 'diskCacheMB',
        label: 'Disk cache',
        detail: 'Parts already fetched, for seeking back and replays',
        explain:
          'What’s been fetched stays on disk, so seeking back and watching again don’t download it again. Auto is 512 MB, less when the system asks.',
        options: [
          { value: -1, label: 'Auto' },
          { value: 0, label: 'Off' },
          { value: 256, label: '256 MB' },
          { value: 1024, label: '1 GB' },
          { value: 2048, label: '2 GB' },
        ],
      },
      {
        kind: 'choice',
        key: 'chunkKB',
        label: 'Chunk size',
        detail: 'What one request to the server fetches',
        explain:
          'Larger suits a slow or distant server; smaller starts and seeks sooner. Changing it empties the disk cache.',
        options: [
          { value: 512, label: '512 KB' },
          { value: 1024, label: '1 MB' },
          { value: 2048, label: '2 MB' },
          { value: 4096, label: '4 MB' },
        ],
      },
      {
        kind: 'segments',
        key: 'readAhead',
        label: 'Read ahead',
        detail:
          'Chunks fetched past the one playing. More rides out a shaky network.',
        options: [
          { value: 0, label: 'None' },
          { value: 1, label: '1' },
          { value: 2, label: '2' },
          { value: 3, label: '3' },
          { value: 4, label: '4' },
        ],
      },
      ...(android
        ? [
            {
              kind: 'switch' as const,
              key: 'wifiLock' as const,
              label: 'Keep Wi-Fi awake while playing',
              detail:
                'Stops the device dropping Wi-Fi to save power mid-video.',
              tag: 'Android',
            },
          ]
        : []),
      {
        kind: 'switch',
        key: 'tlsVerify',
        label: 'Check server certificates',
        detail:
          'The player’s own check of an https server. Off, it trusts the server the app signed in to.',
      },
    ],
  },
  {
    title: 'Diagnostics',
    icon: 'pulse',
    description:
      'For finding out why a video won’t play. The logs slow playback a little.',
    rows: [
      {
        kind: 'switch',
        key: 'stats',
        label: 'Playback statistics',
        detail: 'Over the video: decoder, resolution, cache and network.',
      },
      {
        kind: 'segments',
        key: 'playerLog',
        label: 'Player log',
        detail: android
          ? 'mpv’s log in logcat (tag mpv), for a bug report.'
          : 'mpv’s log in the debugger’s output, for a bug report.',
        options: [
          { value: 'warn', label: 'Warnings' },
          { value: 'info', label: 'Info' },
          { value: 'v', label: 'Verbose' },
        ],
      },
      {
        kind: 'switch',
        key: 'networkLog',
        label: 'Log network requests',
        detail:
          'A log line for every chunk the player reads, and where it came from.',
      },
    ],
  },
  {
    title: 'About',
    icon: 'info',
    description: 'This app and this device.',
    rows: [{ kind: 'about' }, { kind: 'reset' }],
  },
];

/** A choice row's current label ("10 s"), from its value. */
export function choiceLabel(
  row: Extract<Row, { kind: 'choice' }>,
  value: number
) {
  return row.options.find((o) => o.value === value)?.label ?? String(value);
}
