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
  tags?: { id: number; name: string }[];
  performers?: { id: number; name: string }[];
  groups?: { id: number; name: string; videoIndex: number | null }[];
}

/** The signed-in user's own data about a video (engagement/batch); not part of the video itself. */
export interface Engagement {
  hostId: number;
  isFavorite: boolean;
  rating: number | null; // 0–100
  resumeTime: number; // seconds
  playCount: number;
}

/** A segment of a video (Cove's segments; the design calls them moments): a span with a name. */
export interface Segment {
  id: number;
  startSec: number;
  endSec: number | null;
  title: string | null;
  tagName: string | null;
  kind: string | null;
}

/** What videos/aggregate sums up for a filter. */
export interface Aggregate {
  count: number;
  duration: number; // seconds
  fileSize: number; // bytes
}

/**
 * A saved filter (savedfilters, per user), as Cove's web UI writes it: JSON strings of its page state. objectFilter
 * holds flat criteria and the rule tree under "_filterExpression"; uiOptions has displayMode ("grid", "list", ...).
 */
export interface SavedFilter {
  id: number;
  mode: string;
  name: string;
  findFilter: string | null;
  objectFilter: string | null;
  uiOptions: string | null;
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

/**
 * A rule tree of video filters (Cove's FilterExpression): groups of filters; a leaf is a VideoFilter with one
 * criterion, e.g. { tagsCriterion: { value: [3], modifier: 'includes' } }. NOT takes exactly one child.
 */
export interface FilterExpression {
  operator: 'AND' | 'OR' | 'JUST_ONE' | 'NOT';
  children: FilterNode[];
}

export type FilterNode =
  { filter: Record<string, unknown> } | { group: FilterExpression };

/** A tag, performer, studio, group or gallery, as filter value pickers list them. */
export interface NamedEntity {
  id: number;
  name: string;
}

/** A folder of Cove's library (metadata/library-folders): a library root or a folder under one. */
export interface LibraryFolder {
  name: string;
  path: string;
  hasChildren: boolean;
}
