import { primaryFile } from './api/cove';
import type { Video } from './api/types';

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
