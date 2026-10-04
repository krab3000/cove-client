// The parts of Cove's REST API this client uses (see Cove's ui/src/api/types.ts and src/Cove.Core/DTOs/DTOs.cs).

export interface VideoFile {
  id: number;
  basename: string;
  format: string | null;
  width: number | null;
  height: number | null;
  duration: number | null; // seconds
  videoCodec: string | null;
  audioCodec: string | null;
  frameRate: number | null;
  bitRate: number | null;
  size: number | null;
}

export interface Video {
  id: number;
  title: string | null;
  date: string | null; // partial date, e.g. "2021" or "2021-05-03"
  studioName: string | null;
  createdAt: string;
  updatedAt: string;
  files: VideoFile[];
  primaryFileId: number | null;
  imagePath: string | null; // null when the video has no cover yet
  parentVideoId: number | null; // a clip of another video: plays the parent's file
  clipStartSec: number | null;
  clipEndSec: number | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  totalCount: number;
  page: number;
  perPage: number;
}

export interface LoginResponse {
  token: string;
  refreshToken: string;
  accessExpires: string;
  refreshExpires: string;
  username: string;
}

export interface ApiTokenResponse {
  id: string;
  plaintextToken: string;
  expiresAt: string | null;
}
