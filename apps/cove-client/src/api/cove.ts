import { Platform } from 'react-native';
import type {
  ApiTokenResponse,
  LoginResponse,
  PaginatedResponse,
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

// Sprite sheets (seek-bar and card frames) are off for now: one is a 2880×1620 JPEG, 19 MB decoded, to show a
// 300 px frame, which starves weak devices' memory and GPU. Turn back on once frames come cropped.
const SPRITE_SHEETS = false;

// How long the media token (thumbnail and stream URLs) lives.
const MEDIA_TOKEN_HOURS = 24;

/**
 * A session with a Cove server, like Cove's own CLI client (cli/src/client.ts): a 15-minute access JWT sent as a
 * Bearer header, refreshed once on 401 with the rotating refresh token.
 *
 * Media URLs (thumbnails, the video stream) carry a token as ?access_token=, since images and the player cannot
 * send headers. A JWT there would expire mid-playback (FFmpeg keeps issuing range requests on the same URL), so
 * after login the client issues a read-only API token for them; without the permission to do so it falls back to
 * the JWT.
 */
export class CoveClient {
  private refreshing: Promise<void> | null = null;
  // Sprite sheets by video id: hovering a card again does not fetch its index again.
  private sprites = new Map<number, Promise<SpriteSheet | null>>();
  // Whether a video has a preview clip, by video id.
  private previews = new Map<number, Promise<boolean>>();
  private mediaToken: string | null = null;
  private mediaTokenId: string | null = null;

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
    await client.issueMediaToken();
    return client;
  }

  async logout(): Promise<void> {
    try {
      if (this.mediaTokenId)
        await this.request('DELETE', `apitokens/${this.mediaTokenId}`);
      await CoveClient.send(this.server, 'POST', 'auth/logout', {
        refreshToken: this.refreshToken,
      });
    } catch {
      // the session ends locally either way
    }
  }

  findVideos(page: number, perPage: number) {
    // A secondary sort keeps page boundaries stable (like Cove's CLI).
    return this.request<PaginatedResponse<Video>>('POST', 'videos/find', {
      findFilter: {
        page,
        perPage,
        sort: 'created_at',
        direction: 'desc',
        sorts: [
          { key: 'created_at', direction: 'desc' },
          { key: 'updated_at', direction: 'desc' },
        ],
      },
    });
  }

  imageUrl(video: Video, max = 640): string {
    return (
      `${this.server}/api/videos/${video.id}/image?max=${max}` +
      `&v=${encodeURIComponent(video.updatedAt)}&access_token=${encodeURIComponent(this.mediaAccessToken)}`
    );
  }

  streamUrl(video: Video): string {
    const file = primaryFile(video);
    return (
      `${this.server}/api/stream/video/${video.id}?` +
      (file ? `fileId=${file.id}&` : '') +
      `access_token=${encodeURIComponent(this.mediaAccessToken)}`
    );
  }

  /** The short preview clip Cove's generate task makes (low resolution, a few seconds); see previewAvailable. */
  previewUrl(video: Video): string {
    return `${this.server}/api/stream/video/${video.id}/preview?access_token=${encodeURIComponent(this.mediaAccessToken)}`;
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
      url: `${this.server}/api/stream/video/${video.id}/sprite?access_token=${encodeURIComponent(this.mediaAccessToken)}`,
      cues,
      width: Math.max(...cues.map((c) => c.x + c.w)),
      height: Math.max(...cues.map((c) => c.y + c.h)),
    };
  }

  private get mediaAccessToken(): string {
    return this.mediaToken ?? this.accessToken;
  }

  private async issueMediaToken(): Promise<void> {
    try {
      const expiresAt = new Date(
        Date.now() + MEDIA_TOKEN_HOURS * 3600_000
      ).toISOString();
      const token = await this.request<ApiTokenResponse>('POST', 'apitokens', {
        name: `cove-client (${Platform.OS})`,
        scope: ['videos.read', 'stream.read'],
        expiresAt,
      });
      this.mediaToken = token.plaintextToken;
      this.mediaTokenId = token.id;
    } catch {
      this.mediaToken = null; // no api_tokens.write: media URLs use the JWT
    }
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

function describe(status: number, code?: string, detail?: string): string {
  if (code === 'INVALID_CREDENTIALS') return 'Wrong username or password.';
  if (code === 'ACCOUNT_DISABLED') return 'This account is disabled.';
  if (status === 429)
    return 'Too many attempts; wait a few seconds and try again.';
  if (status === 401) return 'The session has expired; log in again.';
  if (status === 403) return 'This account may not do that.';
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
