import { Platform } from 'react-native';
import type {
  Aggregate,
  Engagement,
  FilterExpression,
  Segment,
  LibraryFolder,
  LoginResponse,
  NamedEntity,
  PaginatedResponse,
  SavedFilter,
  Video,
  VideoFile,
} from './types';

export class CoveError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
  }
}

/**
 * What a failure means for a session: it ran out ('expired': refused, or its refresh token rotated elsewhere: sign in
 * again), the server didn't answer ('offline'), or something else (null).
 */
export function authFailure(error: unknown): 'expired' | 'offline' | null {
  if (!(error instanceof CoveError)) return null;
  if (error.status === 401 || error.status === 409) return 'expired';
  if (error.status === 0) return 'offline';
  return null;
}

// Sprite sheets (seek-bar and card frames) are off for now: one is a 2880×1620 JPEG, 19 MB decoded, to show a
// 300 px frame, which starves weak devices' memory and GPU. Turn back on once frames come cropped.
const SPRITE_SHEETS = false;

// The access JWT is renewed this long before it expires (Cove's last 15 minutes by default).
const RENEW_EARLY_MS = 60_000;
// A renewal that failed (offline, the server restarting) is tried again after this long.
const RENEW_RETRY_MS = 30_000;
// Android: media requests (the player, preview downloads, images) carry the JWT as an Authorization header that
// react-native-mpv keeps current (platform/player.android.ts), so media URLs have no token. Elsewhere images load
// bare URLs: the current JWT goes in them.
const TOKEN_IN_MEDIA_URLS = Platform.OS !== 'android';

/**
 * A session with a Cove server, like Cove's own CLI client (cli/src/client.ts): a 15-minute access JWT sent as a
 * Bearer header, renewed with the rotating refresh token a minute before it expires (and once on a 401).
 *
 * Media (thumbnails, frames, preview clips, the video stream) uses the same JWT, never an API token: Cove checks an
 * API token with BCrypt on every request (~300 ms each), a JWT by its signature. On Android media requests send it
 * as a header that follows every renewal (onAccessToken), so a long playback outlives any one token; elsewhere media
 * URLs carry it (mediaAuth).
 */
export class CoveClient {
  private refreshing: Promise<void> | null = null;
  // Sprite sheets by video id: hovering a card again does not fetch its index again.
  private sprites = new Map<number, Promise<SpriteSheet | null>>();
  // Whether a video has a preview clip, by video id.
  private previews = new Map<number, Promise<boolean>>();
  private renewTimer: ReturnType<typeof setTimeout> | null = null;
  private tokenListeners = new Set<(accessToken: string) => void>();
  /** Told the new refresh token whenever it rotates, so a session kept on the device follows it. */
  onRefreshToken: ((refreshToken: string) => void) | null = null;

  private constructor(
    readonly server: string,
    readonly username: string,
    private accessToken: string,
    private refreshToken: string
  ) {}

  static async login(
    server: string,
    username: string,
    password: string
  ): Promise<CoveClient> {
    const base = server.trim().replace(/\/+$/, '');
    const response = await CoveClient.send(base, 'POST', 'auth/login', {
      username,
      password,
    });
    const login = (await response.json()) as LoginResponse;
    const client = new CoveClient(
      base,
      login.username,
      login.token,
      login.refreshToken
    );
    client.scheduleRenewal();
    return client;
  }

  /** A session kept on the device, resumed from its refresh token (rejected once it ran out). */
  static async resume(
    server: string,
    username: string,
    refreshToken: string
  ): Promise<CoveClient> {
    const base = server.trim().replace(/\/+$/, '');
    const response = await CoveClient.send(base, 'POST', 'auth/refresh', {
      refreshToken,
    });
    const pair = (await response.json()) as LoginResponse;
    const client = new CoveClient(
      base,
      pair.user?.username ?? username,
      pair.token,
      pair.refreshToken
    );
    client.scheduleRenewal();
    return client;
  }

  /** Whether a server answers (Cove's status needs no sign-in), within a few seconds. */
  static async reachable(server: string): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      await fetch(`${server}/api/system/status`, { signal: controller.signal });
      return true; // any answer: it is there
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Ends a session kept on the device (an account removed from it); quietly, the device forgets it either way. */
  static async revoke(server: string, refreshToken: string): Promise<void> {
    try {
      await CoveClient.send(server, 'POST', 'auth/logout', { refreshToken });
    } catch {}
  }

  /** The session's refresh token now (it rotates on every refresh). */
  get currentRefreshToken(): string {
    return this.refreshToken;
  }

  /** The access JWT now (it renews a minute before it expires). */
  get currentAccessToken(): string {
    return this.accessToken;
  }

  /** Calls listener with the access JWT now and after every renewal. Returns the unsubscribe function. */
  onAccessToken(listener: (accessToken: string) => void): () => void {
    this.tokenListeners.add(listener);
    listener(this.accessToken);
    return () => {
      this.tokenListeners.delete(listener);
    };
  }

  /** Renews the access JWT now (a media request was refused). One renewal runs at a time. */
  renew(): Promise<void> {
    return this.refresh();
  }

  /** Renews the JWT if it expires soon: the app is back in front, and timers did not run in the background. */
  async renewIfExpiring(): Promise<void> {
    const expires = jwtExpiry(this.accessToken);
    if (expires !== null && expires - Date.now() < RENEW_EARLY_MS * 2)
      await this.refresh();
    else this.scheduleRenewal();
  }

  /** The session is over here: no more renewals or listeners. */
  dispose(): void {
    if (this.renewTimer) clearTimeout(this.renewTimer);
    this.renewTimer = null;
    this.tokenListeners.clear();
  }

  async logout(): Promise<void> {
    this.dispose();
    try {
      await CoveClient.send(this.server, 'POST', 'auth/logout', {
        refreshToken: this.refreshToken,
      });
    } catch {
      // the session ends locally either way
    }
  }

  /**
   * A page of videos, newest first, or shuffled (Cove's seeded random sort: the same seed, the same order). q is
   * Cove's search (title, tags, performers, ... as in its web UI), on top of the filter.
   */
  findVideos(
    page: number,
    perPage: number,
    filterExpression?: FilterExpression | null,
    shuffleSeed?: number | null,
    q?: string
  ) {
    return this.request<PaginatedResponse<Video>>('POST', 'videos/find', {
      findFilter: {
        ...searchFilter(q),
        ...(shuffleSeed != null
          ? {
              page,
              perPage,
              sort: 'random',
              direction: 'asc',
              seed: shuffleSeed,
            }
          : {
              page,
              perPage,
              sort: 'created_at',
              direction: 'desc',
              // A secondary sort keeps page boundaries stable (like Cove's CLI).
              sorts: [
                { key: 'created_at', direction: 'desc' },
                { key: 'updated_at', direction: 'desc' },
              ],
            }),
      },
      ...(filterExpression ? { filterExpression } : {}),
    });
  }

  /** How many videos match a filter and search, their total duration and file size. */
  aggregateVideos(filterExpression?: FilterExpression | null, q?: string) {
    return this.request<Aggregate>('POST', 'videos/aggregate', {
      findFilter: searchFilter(q),
      ...(filterExpression ? { filterExpression } : {}),
    });
  }

  /** The video's segments, in time order ([] when the account may not read segments). */
  async segments(video: Video): Promise<Segment[]> {
    try {
      return await this.request<Segment[]>(
        'GET',
        `videos/${video.id}/segments`
      );
    } catch {
      return [];
    }
  }

  /**
   * A frame of the video at a time (seconds in its file): Cove serves its generated thumbnails or a cell of the
   * sprite sheet, cropped (nothing is decoded on request), else the cover.
   */
  frameUrl(video: Video, seconds: number): string {
    return (
      `${this.server}/api/stream/video/${video.id}/screenshot?seconds=${Math.max(0, Math.round(seconds))}` +
      this.mediaAuth('&')
    );
  }

  /**
   * Reports what was watched, like Cove's web player: the spans played since the last report, the position and the
   * state ('active', 'paused', 'ended'). Cove keeps the resume position and counts views from these.
   */
  recordPlayback(report: {
    hostId: number;
    sessionId: string;
    mediaDurationSec: number;
    currentPositionSec: number;
    state: 'active' | 'paused' | 'ended';
    intervals: { startSec: number; endSec: number }[];
  }) {
    return this.request<void>('POST', 'playback/intervals', {
      hostType: 'video',
      surface: 'mobile-player',
      ...report,
    });
  }

  /** The user's rating, favorite, play count and resume time for these videos. */
  engagement(ids: number[]) {
    return this.request<Engagement[]>('POST', 'engagement/batch', {
      hostType: 'video',
      hostIds: ids,
    });
  }

  setFavorite(id: number, isFavorite: boolean) {
    return this.request<Engagement>('PUT', `engagement/video/${id}/favorite`, {
      isFavorite,
    });
  }

  /** Which of these videos the user saved for later (Cove's bookmarks). */
  async savedForLater(ids: number[]): Promise<Set<number>> {
    const result = await this.request<{ hostId: number; saved: boolean }[]>(
      'POST',
      'me/bookmarks/batch',
      { hostType: 'video', hostIds: ids }
    );
    return new Set(result.filter((b) => b.saved).map((b) => b.hostId));
  }

  setSavedForLater(id: number, saved: boolean) {
    return this.request('POST', 'me/bookmarks', {
      hostType: 'video',
      hostId: id,
      saved,
    });
  }

  savedFilters() {
    return this.request<SavedFilter[]>('GET', 'savedfilters?mode=videos');
  }

  updateSavedFilter(
    id: number,
    change: { findFilter?: string; objectFilter?: string; uiOptions?: string }
  ) {
    return this.request<SavedFilter>('PUT', `savedfilters/${id}`, change);
  }

  /** A new saved filter; Cove refuses a name already taken (409). */
  createSavedFilter(filter: Omit<SavedFilter, 'id'>) {
    return this.request<SavedFilter>('POST', 'savedfilters', filter);
  }

  /** The name of a tag, performer, studio, group or gallery, by id. */
  async entityName(
    kind: 'tags' | 'performers' | 'studios' | 'groups' | 'galleries',
    id: number
  ): Promise<string> {
    const item = await this.request<Record<string, unknown>>(
      'GET',
      `${kind}/${id}`
    );
    return String(item[kind === 'galleries' ? 'title' : 'name'] ?? `#${id}`);
  }

  /** How many videos match a filter and search (perPage 0: Cove only counts). */
  async countVideos(
    filterExpression?: FilterExpression | null,
    q?: string
  ): Promise<number> {
    const result = await this.request<PaginatedResponse<Video>>(
      'POST',
      'videos/find',
      {
        findFilter: { ...searchFilter(q), page: 1, perPage: 0 },
        ...(filterExpression ? { filterExpression } : {}),
      }
    );
    return result.totalCount;
  }

  /**
   * The library's root folders, or the folders right under one of its folders. Throws a CoveError with status 403
   * when the account may not list folders (Cove wants Library scan or Files read), or for a path outside the library.
   */
  libraryFolders(path?: string): Promise<LibraryFolder[]> {
    return this.request<LibraryFolder[]>(
      'GET',
      `metadata/library-folders${path ? `?path=${encodeURIComponent(path)}` : ''}`
    );
  }

  /** Tags, performers, studios, groups or galleries matching a search, for filter value pickers. */
  async lookup(
    kind: 'tags' | 'performers' | 'studios' | 'groups' | 'galleries',
    q: string
  ): Promise<NamedEntity[]> {
    const nameKey = kind === 'galleries' ? 'title' : 'name';
    const params = [
      'perPage=50',
      q.trim()
        ? `q=${encodeURIComponent(q.trim())}`
        : `sort=${nameKey}&direction=asc`,
      kind === 'tags' ? 'includeCounts=false' : '',
    ].filter(Boolean);
    const result = await this.request<
      PaginatedResponse<Record<string, unknown>>
    >('GET', `${kind}?${params.join('&')}`);
    return result.items.map((item) => ({
      id: Number(item.id),
      name: String(item[nameKey] ?? `#${item.id}`),
    }));
  }

  imageUrl(video: Video, max = 640): string {
    return (
      `${this.server}/api/videos/${video.id}/image?max=${max}` +
      `&v=${encodeURIComponent(video.updatedAt)}${this.mediaAuth('&')}`
    );
  }

  streamUrl(video: Video): string {
    const file = primaryFile(video);
    return (
      `${this.server}/api/stream/video/${video.id}` +
      (file ? `?fileId=${file.id}` : '') +
      this.mediaAuth(file ? '&' : '?')
    );
  }

  /** The short preview clip Cove's generate task makes (low resolution, a few seconds); see previewAvailable. */
  previewUrl(video: Video): string {
    return `${this.server}/api/stream/video/${video.id}/preview${this.mediaAuth('?')}`;
  }

  previewAvailable(video: Video): Promise<boolean> {
    let available = this.previews.get(video.id);
    if (!available) {
      available = this.request<{ available: boolean }>(
        'GET',
        `stream/video/${video.id}/preview/status`
      ).then(
        (status) => status.available,
        () => false
      );
      this.previews.set(video.id, available);
    }
    return available;
  }

  /**
   * The seek-bar thumbnails Cove's generate task makes (a sprite sheet and a WebVTT index of its cells), or null
   * when the video has none yet.
   */
  spriteSheet(video: Video): Promise<SpriteSheet | null> {
    if (!SPRITE_SHEETS) return Promise.resolve(null);
    let sheet = this.sprites.get(video.id);
    if (!sheet) {
      sheet = this.fetchSpriteSheet(video);
      this.sprites.set(video.id, sheet);
    }
    return sheet;
  }

  private async fetchSpriteSheet(video: Video): Promise<SpriteSheet | null> {
    let vtt: string;
    try {
      vtt = await this.request<string>(
        'GET',
        `stream/video/${video.id}/vtt/thumbs`,
        undefined,
        true,
        'text'
      );
    } catch {
      return null;
    }
    const cues = parseSpriteVtt(vtt);
    if (!cues.length) return null;
    return {
      url: `${this.server}/api/stream/video/${video.id}/sprite${this.mediaAuth('?')}`,
      cues,
      width: Math.max(...cues.map((c) => c.x + c.w)),
      height: Math.max(...cues.map((c) => c.y + c.h)),
    };
  }

  /** The token part of a media URL: none on Android (a header carries it), else the current JWT. */
  private mediaAuth(separator: '?' | '&'): string {
    return TOKEN_IN_MEDIA_URLS
      ? `${separator}access_token=${encodeURIComponent(this.accessToken)}`
      : '';
  }

  /** Renews the JWT a minute before it expires (again after a while if that fails, e.g. offline). */
  private scheduleRenewal(delay?: number): void {
    if (this.renewTimer) clearTimeout(this.renewTimer);
    const expires = jwtExpiry(this.accessToken);
    if (delay === undefined && expires === null) return;
    const wait =
      delay ?? Math.max(5_000, expires! - Date.now() - RENEW_EARLY_MS);
    this.renewTimer = setTimeout(() => {
      this.renewTimer = null;
      this.refresh().catch((e) => {
        if (authFailure(e) !== 'expired') this.scheduleRenewal(RENEW_RETRY_MS);
      });
    }, wait);
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    allowRefresh = true,
    as: 'json' | 'text' = 'json'
  ): Promise<T> {
    try {
      const response = await CoveClient.send(
        this.server,
        method,
        path,
        body,
        this.accessToken
      );
      if (response.status === 204) return undefined as T;
      return (
        as === 'text' ? await response.text() : await response.json()
      ) as T;
    } catch (e) {
      if (allowRefresh && e instanceof CoveError && e.status === 401) {
        await this.refresh();
        return this.request<T>(method, path, body, false, as);
      }
      throw e;
    }
  }

  private refresh(): Promise<void> {
    // One refresh at a time: the refresh token rotates, so a second concurrent refresh would fail.
    this.refreshing ??= (async () => {
      try {
        const response = await CoveClient.send(
          this.server,
          'POST',
          'auth/refresh',
          { refreshToken: this.refreshToken }
        );
        const pair = (await response.json()) as LoginResponse;
        this.accessToken = pair.token;
        this.refreshToken = pair.refreshToken;
        this.onRefreshToken?.(pair.refreshToken);
        this.scheduleRenewal();
        for (const listener of this.tokenListeners) listener(pair.token);
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private static async send(
    server: string,
    method: string,
    path: string,
    body?: unknown,
    accessToken?: string
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    let response: Response;
    try {
      response = await fetch(`${server}/api/${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      const detail = await networkErrorDetail(`${server}/health`);
      throw new CoveError(
        `Cannot reach ${server}: ${detail ?? (e instanceof Error ? e.message : String(e))}`,
        0
      );
    }
    if (!response.ok) {
      let code: string | undefined;
      let detail = '';
      try {
        const error = await response.json();
        code = error.code;
        detail = error.message ?? error.title ?? '';
      } catch {}
      throw new CoveError(
        describe(response.status, code, detail),
        response.status,
        code
      );
    }
    return response;
  }
}

// Hermes has atob (base64 to a binary string); React Native's TypeScript types don't declare it.
declare function atob(data: string): string;

/** When a JWT expires (ms since the epoch), from its exp claim; null if it cannot be read. */
function jwtExpiry(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const payload = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const exp = JSON.parse(atob(padded)).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Cove's search text in a findFilter, when there is any. */
function searchFilter(q?: string): { q?: string } {
  return q?.trim() ? { q: q.trim() } : {};
}

function describe(status: number, code?: string, detail?: string): string {
  if (code === 'INVALID_CREDENTIALS') return 'Wrong username or password.';
  if (code === 'ACCOUNT_DISABLED') return 'This account is disabled.';
  if (status === 429)
    return 'Too many attempts; wait a few seconds and try again.';
  if (status === 401) return 'The session has expired; log in again.';
  if (status === 403) return 'This account may not do that.';
  if (status === 409 && detail) return detail; // e.g. a saved filter name already taken
  return `Server error ${status}${detail ? `: ${detail}` : ''}`;
}

/**
 * fetch only says "Network request failed"; React Native's XMLHttpRequest keeps the native error (DNS, TLS trust,
 * connection refused, ...) in responseText. Asks again with it to say what went wrong.
 */
function networkErrorDetail(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.timeout = 10000;
    xhr.onload = () => resolve(null); // reachable now
    xhr.onerror = xhr.ontimeout = () =>
      resolve(xhr.responseText ? String(xhr.responseText) : null);
    xhr.open('GET', url);
    xhr.send();
  });
}

export interface SpriteCue {
  start: number; // seconds
  end: number;
  x: number; // the cell in the sprite sheet
  y: number;
  w: number;
  h: number;
}

export interface SpriteSheet {
  url: string;
  cues: SpriteCue[];
  width: number; // the whole sheet
  height: number;
}

/** Cove's thumbs VTT: "00:00:07.971 --> 00:00:15.943" then "<id>_sprite.jpg#xywh=320,0,320,570". */
function parseSpriteVtt(vtt: string): SpriteCue[] {
  const seconds = (t: string) =>
    t.split(':').reduce((acc, part) => acc * 60 + parseFloat(part), 0);
  const cues: SpriteCue[] = [];
  const lines = vtt.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    const time = /^([\d:.]+)\s*-->\s*([\d:.]+)/.exec(lines[i]!.trim());
    const cell = time && /#xywh=(\d+),(\d+),(\d+),(\d+)/.exec(lines[i + 1]!);
    if (time && cell) {
      cues.push({
        start: seconds(time[1]!),
        end: seconds(time[2]!),
        x: +cell[1]!,
        y: +cell[2]!,
        w: +cell[3]!,
        h: +cell[4]!,
      });
    }
  }
  return cues;
}

export function primaryFile(video: Video): VideoFile | undefined {
  return (
    video.files.find((f) => f.id === video.primaryFileId) ?? video.files[0]
  );
}

