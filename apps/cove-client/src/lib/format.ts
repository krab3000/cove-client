import { primaryFile } from '../api/cove';
import type { Video } from '../api/types';

/** 75 -> "1:15", 3725 -> "1:02:05" */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds) || seconds < 0) return '';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The usual name of a resolution: its shorter side, "4K" for 2160 and up. */
export function resolutionLabel(video: Video): string {
  const file = primaryFile(video);
  if (!file?.width || !file.height) return '';
  const lines = Math.min(file.width, file.height);
  if (lines >= 2100) return lines >= 4300 ? '8K' : '4K';
  return `${lines}p`;
}

export function videoTitle(video: Video): string {
  if (video.title?.trim()) return video.title;
  const name = primaryFile(video)?.basename ?? `Video ${video.id}`;
  return name.replace(/\.[^.]+$/, ''); // without the extension
}

export function videoSubtitle(video: Video): string {
  const date = video.date ?? video.createdAt.slice(0, 10);
  return [video.studioName, date].filter(Boolean).join(' · ');
}

export const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Cove's partial dates as people write them: "1962", "Oct 2022", "Jun 12, 2024". */
export function partialDate(date: string): string {
  const [y, m, d] = date.split('-');
  if (!m) return y ?? date;
  const month = MONTHS[Number(m) - 1] ?? m;
  return d ? `${month} ${Number(d)}, ${y}` : `${month} ${y}`;
}

/** Cove's rating (0–100) as stars out of 5, in halves: 90 -> "4.5". */
export function stars(rating: number): string {
  return (Math.round(rating / 10) / 2).toFixed(1);
}

/** "Ines Ravel" -> "IR": a person's avatar. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/** "maya" -> "M": an account's avatar. */
export function initialOf(name: string): string {
  return (name[0] ?? '?').toUpperCase();
}

/** 945e9 -> "945 GB" */
export function formatSize(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${Math.round(bytes / 1e9)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

/** 5934 -> "5,934" */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** "3 days ago", "5 min ago": how long since a time (ms since the epoch). */
export function ago(time: number): string {
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** A video's group: "Northern Trips · part 3". */
export function groupLabel(group: {
  name: string;
  videoIndex?: number | null;
}): string {
  return group.videoIndex != null
    ? `${group.name} · part ${group.videoIndex + 1}`
    : group.name;
}

/** "studio · date · watched N×" (or "unwatched", once the play count is known). */
export function videoMeta(video: Video, playCount: number | null): string {
  return [
    video.studioName,
    video.date ? partialDate(video.date) : null,
    playCount == null
      ? null
      : playCount
        ? `watched ${playCount}×`
        : 'unwatched',
  ]
    .filter(Boolean)
    .join(' · ');
}
