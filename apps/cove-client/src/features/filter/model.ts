import type { FilterExpression, FilterNode } from '../../api/types';
import { MONTHS } from '../../utils/format';

// The rule tree of a Cove video filter (design 2b), and its translation to Cove's API: a filterExpression of groups
// (AND / OR / JUST_ONE / NOT) whose leaves are one-criterion VideoFilter objects. Fields, modifiers and value encodings
// follow Cove's web UI (ui/src/components/filterCriteriaCatalogs.ts, CriterionEditor.tsx) and server
// (Cove.Core IRepository.cs VideoFilter, ResolutionBuckets.cs, RelativeDateEvaluation.cs).

export type GroupOp = 'all' | 'any' | 'one' | 'none';
export const GROUP_OPS: GroupOp[] = ['all', 'any', 'one', 'none'];
export const GROUP_LABELS: Record<GroupOp, string> = {
  all: 'All of',
  any: 'Any of',
  one: 'Just one of',
  none: 'None of',
};

export type Modifier =
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'lessThan'
  | 'between'
  | 'notBetween'
  | 'includes'
  | 'includesAll'
  | 'excludes'
  | 'excludesAll'
  | 'isNull'
  | 'notNull'
  | 'matchesRegex'
  | 'notMatchesRegex'
  | 'underPath'
  | 'notUnderPath';

export type FieldType =
  | 'multiId'
  | 'resolution'
  | 'duration'
  | 'rating'
  | 'number'
  | 'date'
  | 'timestamp'
  | 'string'
  | 'path'
  | 'bool'
  | 'orientation';

export type LookupKind =
  'tags' | 'performers' | 'studios' | 'groups' | 'galleries';

export type FieldSection =
  'People & tags' | 'Video' | 'Dates' | 'Counts' | 'Text' | 'Flags';

export interface Field {
  id: string;
  label: string;
  type: FieldType;
  /** The VideoFilter property */
  key: string;
  section: FieldSection;
  modifiers: Modifier[];
  lookup?: LookupKind;
}

const STRING: Modifier[] = [
  'includes',
  'excludes',
  'equals',
  'notEquals',
  'matchesRegex',
  'notMatchesRegex',
  'isNull',
  'notNull',
];
const NUMBER: Modifier[] = [
  'greaterThan',
  'lessThan',
  'equals',
  'notEquals',
  'between',
  'notBetween',
  'isNull',
  'notNull',
];
const NON_NULL_NUMBER: Modifier[] = [
  'greaterThan',
  'lessThan',
  'equals',
  'notEquals',
  'between',
  'notBetween',
];
const MULTI_ID: Modifier[] = [
  'includes',
  'includesAll',
  'excludes',
  'excludesAll',
  'isNull',
  'notNull',
];
const DATE: Modifier[] = [
  'between',
  'greaterThan',
  'lessThan',
  'equals',
  'notEquals',
  'notBetween',
  'isNull',
  'notNull',
];

const field = (
  id: string,
  label: string,
  type: FieldType,
  key: string,
  section: FieldSection,
  modifiers: Modifier[],
  lookup?: LookupKind
): Field => ({ id, label, type, key, section, modifiers, lookup });

/** Cove's video criteria, without related performers, tag duration, hashes, duplicates and remote ids. */
export const FIELDS: Field[] = [
  field(
    'tags',
    'Tag',
    'multiId',
    'tagsCriterion',
    'People & tags',
    MULTI_ID,
    'tags'
  ),
  field(
    'performers',
    'Performer',
    'multiId',
    'performersCriterion',
    'People & tags',
    MULTI_ID,
    'performers'
  ),
  field(
    'studios',
    'Studio',
    'multiId',
    'studiosCriterion',
    'People & tags',
    MULTI_ID,
    'studios'
  ),
  field(
    'groups',
    'Group',
    'multiId',
    'groupsCriterion',
    'People & tags',
    MULTI_ID,
    'groups'
  ),
  field(
    'galleries',
    'Gallery',
    'multiId',
    'galleriesCriterion',
    'People & tags',
    MULTI_ID,
    'galleries'
  ),
  field(
    'performerAge',
    'Performer age',
    'number',
    'performerAgeCriterion',
    'People & tags',
    NUMBER
  ),
  field(
    'resolution',
    'Resolution',
    'resolution',
    'resolutionCriterion',
    'Video',
    ['equals', 'notEquals', 'greaterThan', 'lessThan']
  ),
  field(
    'duration',
    'Duration',
    'duration',
    'durationCriterion',
    'Video',
    NON_NULL_NUMBER
  ),
  field(
    'orientation',
    'Orientation',
    'orientation',
    'orientationCriterion',
    'Video',
    ['equals', 'notEquals']
  ),
  field('rating', 'Rating', 'rating', 'ratingCriterion', 'Video', NUMBER),
  field(
    'frameRate',
    'Frame rate',
    'number',
    'frameRateCriterion',
    'Video',
    NON_NULL_NUMBER
  ),
  field(
    'bitrate',
    'Bitrate (kbps)',
    'number',
    'bitrateInterval',
    'Video',
    NUMBER
  ),
  field(
    'videoCodec',
    'Video codec',
    'string',
    'videoCodecCriterion',
    'Video',
    STRING
  ),
  field(
    'audioCodec',
    'Audio codec',
    'string',
    'audioCodecCriterion',
    'Video',
    STRING
  ),
  field('createdAt', 'Added', 'timestamp', 'createdAtCriterion', 'Dates', DATE),
  field('date', 'Date', 'date', 'dateCriterion', 'Dates', DATE),
  field(
    'updatedAt',
    'Updated',
    'timestamp',
    'updatedAtCriterion',
    'Dates',
    DATE
  ),
  field(
    'lastPlayedAt',
    'Last played',
    'timestamp',
    'lastPlayedAtCriterion',
    'Dates',
    DATE
  ),
  field(
    'playCount',
    'Play count',
    'number',
    'playCountCriterion',
    'Counts',
    NON_NULL_NUMBER
  ),
  field(
    'playDuration',
    'Play duration',
    'duration',
    'playDurationCriterion',
    'Counts',
    NON_NULL_NUMBER
  ),
  field(
    'resumeTime',
    'Resume time',
    'duration',
    'resumeTimeCriterion',
    'Counts',
    NON_NULL_NUMBER
  ),
  field(
    'likeCounter',
    'Likes',
    'number',
    'likeCounterCriterion',
    'Counts',
    NUMBER
  ),
  field(
    'performerCount',
    'Performer count',
    'number',
    'performerCountCriterion',
    'Counts',
    NON_NULL_NUMBER
  ),
  field(
    'tagCount',
    'Tag count',
    'number',
    'tagCountCriterion',
    'Counts',
    NON_NULL_NUMBER
  ),
  field(
    'fileCount',
    'File count',
    'number',
    'fileCountCriterion',
    'Counts',
    NON_NULL_NUMBER
  ),
  field('title', 'Title', 'string', 'titleCriterion', 'Text', STRING),
  field('details', 'Details', 'string', 'detailsCriterion', 'Text', STRING),
  field('director', 'Director', 'string', 'directorCriterion', 'Text', STRING),
  field('code', 'Studio code', 'string', 'codeCriterion', 'Text', STRING),
  field('url', 'URL', 'string', 'urlCriterion', 'Text', STRING),
  field('captions', 'Captions', 'string', 'captionsCriterion', 'Text', STRING),
  // Design 3a: a folder (and everything inside it), or a text match.
  field('path', 'Path', 'path', 'pathCriterion', 'Text', [
    'underPath',
    'notUnderPath',
    'includes',
    'matchesRegex',
  ]),
  field('favorite', 'Favorite', 'bool', 'favoriteCriterion', 'Flags', [
    'equals',
  ]),
  field('organized', 'Organized', 'bool', 'organizedCriterion', 'Flags', [
    'equals',
  ]),
  field('isVr', 'VR', 'bool', 'isVrCriterion', 'Flags', ['equals']),
  field(
    'hasSegments',
    'Has segments',
    'bool',
    'hasSegmentsCriterion',
    'Flags',
    ['equals']
  ),
];

export const FIELD_SECTIONS: FieldSection[] = [
  'People & tags',
  'Video',
  'Dates',
  'Counts',
  'Text',
  'Flags',
];

export function fieldById(id: string): Field {
  return FIELDS.find((f) => f.id === id) ?? FIELDS[0]!;
}

/** Cove's resolution buckets (the longest side's range, labelled by its usual name). */
export const RESOLUTIONS: { value: number; label: string }[] = [
  { value: 144, label: '144p' },
  { value: 240, label: '240p' },
  { value: 360, label: '360p' },
  { value: 480, label: '480p' },
  { value: 540, label: '540p' },
  { value: 720, label: '720p' },
  { value: 1080, label: '1080p' },
  { value: 1440, label: '1440p' },
  { value: 2160, label: '4K' },
  { value: 2880, label: '5K' },
  { value: 3384, label: '6K' },
  { value: 4032, label: '7K' },
  { value: 4320, label: '8K' },
  { value: 9999, label: 'Huge' },
];

export const ORIENTATIONS = [
  { value: 'landscape', label: 'Landscape' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'square', label: 'Square' },
];

// --- The tree ---------------------------------------------------------------------------------------------------

/** A library folder (Cove's library-folders) */
export interface FolderRef {
  name: string;
  path: string;
}

/** The path match options of design 3a, in its order and words. */
export const PATH_LABELS: Partial<Record<Modifier, string>> = {
  underPath: 'In folder',
  notUnderPath: 'Not in folder',
  includes: 'Contains text',
  matchesRegex: 'Regex',
};

export const isFolderMatch = (m: Modifier) =>
  m === 'underPath' || m === 'notUnderPath';

/** The folders a path names under the library root it is in (names and paths, root first). */
export function folderChain(path: string, roots: FolderRef[]): FolderRef[] {
  const trimmed = path.trim().replace(/[\\/]+$/, '');
  const root = roots.find(
    (r) =>
      trimmed.toLowerCase() === r.path.toLowerCase() ||
      trimmed
        .toLowerCase()
        .startsWith(r.path.toLowerCase().replace(/[\\/]+$/, '') + '/') ||
      trimmed
        .toLowerCase()
        .startsWith(r.path.toLowerCase().replace(/[\\/]+$/, '') + '\\')
  );
  if (!root) {
    const parts = trimmed.split(/[\\/]/).filter(Boolean);
    return parts.length
      ? [{ name: parts[parts.length - 1]!, path: trimmed }]
      : [];
  }
  const sep = root.path.includes('\\') && !root.path.includes('/') ? '\\' : '/';
  const base = root.path.replace(/[\\/]+$/, '');
  const chain: FolderRef[] = [root];
  let current = base;
  for (const part of trimmed
    .slice(base.length)
    .split(/[\\/]/)
    .filter(Boolean)) {
    current = `${current}${sep}${part}`;
    chain.push({ name: part, path: current });
  }
  return chain;
}

/** "Drone/2024": the folder's last two names (the root's own name when it is a root). */
function shortFolder(c: Condition): string {
  const chain = c.folder?.chain;
  if (chain?.length) {
    const below = chain.length > 1 ? chain.slice(1) : chain;
    return below
      .slice(-2)
      .map((f) => f.name)
      .join('/');
  }
  return String(c.value).split(/[\\/]/).filter(Boolean).slice(-2).join('/');
}

export interface Condition {
  kind: 'condition';
  id: string;
  field: string;
  modifier: Modifier;
  /**
   * multiId: ids · resolution: bucket · duration: minutes · rating: stars · number · date/timestamp: "yyyy-mm-dd" or
   * relative ("-7d") · string · bool · orientation
   */
  value: number[] | number | string | boolean;
  value2?: number | string;
  /** multiId: names of the ids, for display */
  names?: Record<number, string>;
  /** path in a folder: the folders from the library root down to it, and how many subfolders it has */
  folder?: { chain: FolderRef[]; subfolders: number };
}

export interface Group {
  kind: 'group';
  id: string;
  op: GroupOp;
  children: Node[];
}

export type Node = Condition | Group;

let nextId = 0;
export const newId = () => `n${++nextId}`;

export const emptyTree = (): Group => ({
  kind: 'group',
  id: newId(),
  op: 'all',
  children: [],
});

export function nextOp(op: GroupOp): GroupOp {
  return GROUP_OPS[(GROUP_OPS.indexOf(op) + 1) % GROUP_OPS.length]!;
}

/** The tree with the node of that id replaced (or removed, with null). */
export function replaceNode(root: Group, id: string, next: Node | null): Group {
  const walk = (group: Group): Group => ({
    ...group,
    children: group.children.flatMap((child) => {
      if (child.id === id) return next ? [next] : [];
      return child.kind === 'group' ? [walk(child)] : [child];
    }),
  });
  if (root.id === id && next?.kind === 'group') return next;
  return walk(root);
}

/** The tree with node appended to the group of that id. */
export function appendTo(root: Group, groupId: string, node: Node): Group {
  if (root.id === groupId)
    return { ...root, children: [...root.children, node] };
  return {
    ...root,
    children: root.children.map((child) =>
      child.kind === 'group' ? appendTo(child, groupId, node) : child
    ),
  };
}

export function conditionCount(group: Group): number {
  return group.children.reduce(
    (n, c) => n + (c.kind === 'group' ? conditionCount(c) : 1),
    0
  );
}

// --- Editing the tree (design 4a–4c): cut / copy / paste, wrap, ungroup ------------------------------------------

export function findNode(root: Group, id: string): Node | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    if (child.id === id) return child;
    if (child.kind === 'group') {
      const found = findNode(child, id);
      if (found) return found;
    }
  }
  return null;
}

/** The group holding the node of that id, and the node's position in it (null for the root or an unknown id). */
export function findParent(
  root: Group,
  id: string
): { parent: Group; index: number } | null {
  const index = root.children.findIndex((c) => c.id === id);
  if (index >= 0) return { parent: root, index };
  for (const child of root.children) {
    if (child.kind === 'group') {
      const found = findParent(child, id);
      if (found) return found;
    }
  }
  return null;
}

/** Whether id is node itself or anything inside it. */
export function contains(node: Node, id: string): boolean {
  if (node.id === id) return true;
  return node.kind === 'group' && node.children.some((c) => contains(c, id));
}

export function removeNode(root: Group, id: string): Group {
  return replaceNode(root, id, null);
}

/** The tree with node placed right before or after the node of that id. */
export function insertRelative(
  root: Group,
  targetId: string,
  node: Node,
  where: 'before' | 'after'
): Group {
  const walk = (group: Group): Group => ({
    ...group,
    children: group.children.flatMap((child) => {
      const self = child.kind === 'group' ? walk(child) : child;
      if (child.id !== targetId) return [self];
      return where === 'before' ? [node, self] : [self, node];
    }),
  });
  return walk(root);
}

/** The node replaced by a new All of group holding it; for the root, a new root around it. */
export function wrapNode(root: Group, id: string): Group {
  const wrap = (node: Node): Group => ({
    kind: 'group',
    id: newId(),
    op: 'all',
    children: [node],
  });
  if (root.id === id) return wrap(root);
  const node = findNode(root, id);
  return node ? replaceNode(root, id, wrap(node)) : root;
}

/** The group's children in its place, in its parent, and the group gone. */
export function ungroup(root: Group, groupId: string): Group {
  const walk = (group: Group): Group => ({
    ...group,
    children: group.children.flatMap((child) => {
      if (child.kind !== 'group') return [child];
      return child.id === groupId
        ? child.children.map((c) => c)
        : [walk(child)];
    }),
  });
  return walk(root);
}

/** A deep copy with new ids (what Copy pastes). */
export function cloneNode<T extends Node>(node: T): T {
  if (node.kind === 'condition') return { ...node, id: newId() };
  return {
    ...node,
    id: newId(),
    children: node.children.map((c) => cloneNode(c)),
  };
}

/** A node in a few words: "Tag includes Drone", "Any of · 2 conditions". */
export function summary(node: Node): string {
  if (node.kind === 'group') {
    const count = conditionCount(node);
    return `${GROUP_LABELS[node.op]} · ${count} condition${count === 1 ? '' : 's'}`;
  }
  const { label, runs } = rowText(node);
  const line = runs
    .map((r) => (r.folder ? '' : r.sep ? '›' : r.text))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return `${label} ${line}`;
}

/** What the clipboard holds: a cut node (pasting moves it) or a copied one (each paste is a new copy). */
export interface Clipboard {
  node: Node;
  mode: 'cut' | 'copy';
}

/** Whether the clipboard can go at a target: never into, before or after a cut node itself or its inside. */
export function canPaste(
  clipboard: Clipboard | null,
  targetId: string
): boolean {
  if (!clipboard) return false;
  return !(clipboard.mode === 'cut' && contains(clipboard.node, targetId));
}

/**
 * The tree with the clipboard pasted: into a group (at its end) or before / after a node. A cut node moves there (it
 * leaves its old place); a copy goes in as a new copy.
 */
export function paste(
  root: Group,
  clipboard: Clipboard,
  target: { into: string } | { at: string; where: 'before' | 'after' }
): Group {
  const targetId = 'into' in target ? target.into : target.at;
  if (!canPaste(clipboard, targetId)) return root;
  // A cut node as it is now (it may have been edited since it was cut).
  const node =
    clipboard.mode === 'copy'
      ? cloneNode(clipboard.node)
      : (findNode(root, clipboard.node.id) ?? clipboard.node);
  const base =
    clipboard.mode === 'cut' ? removeNode(root, clipboard.node.id) : root;
  return 'into' in target
    ? appendTo(base, target.into, node)
    : insertRelative(base, target.at, node, target.where);
}

// --- Deep trees (design 5a–5f): levels, Simplify ------------------------------------------------------------------

/** The groups from the root down to the group of that id, both included (null if it isn't a group in the tree). */
export function findChain(root: Group, id: string): Group[] | null {
  if (root.id === id) return [root];
  for (const child of root.children) {
    if (child.kind === 'group') {
      const chain = findChain(child, id);
      if (chain) return [root, ...chain];
    }
  }
  return null;
}

function groupCount(group: Group): number {
  return group.children.reduce(
    (n, c) => n + (c.kind === 'group' ? groupCount(c) : 0),
    1
  );
}

/**
 * The tree without groups that change nothing, their items merged into the parent: an empty group, a group of one
 * (not None of), an All of in an All of, an Any of in an Any of; and a root holding just one group (unless None of).
 */
export function simplify(root: Group): Group {
  const walk = (group: Group): Group => ({
    ...group,
    children: group.children.flatMap((child): Node[] => {
      if (child.kind !== 'group') return [child];
      const g = walk(child);
      if (!g.children.length) return [];
      if (g.children.length === 1 && g.op !== 'none') return g.children;
      if (g.op === group.op && (g.op === 'all' || g.op === 'any'))
        return g.children;
      return [g];
    }),
  });
  let next = root;
  for (;;) {
    let step = walk(next);
    const only = step.children[0];
    if (
      step.op !== 'none' &&
      step.children.length === 1 &&
      only?.kind === 'group'
    )
      step = only;
    if (groupCount(step) === groupCount(next)) return step;
    next = step;
  }
}

/** How many groups Simplify would merge away. */
export function simplifiable(root: Group): number {
  return groupCount(root) - groupCount(simplify(root));
}

// --- Cove's wire format ---------------------------------------------------------------------------------------

const NO_VALUE: Modifier[] = ['isNull', 'notNull'];
const TWO_VALUES: Modifier[] = ['between', 'notBetween'];

function criterion(c: Condition): Record<string, unknown> {
  const f = fieldById(c.field);
  const empty = NO_VALUE.includes(c.modifier);
  const two = TWO_VALUES.includes(c.modifier);
  const num = (v: unknown, scale = 1) => Math.round(Number(v) * scale);
  switch (f.type) {
    case 'multiId':
      return { value: empty ? [] : c.value, modifier: c.modifier };
    case 'bool':
      return { value: c.value === true };
    case 'duration':
      return {
        value: empty ? 0 : num(c.value, 60),
        ...(two ? { value2: num(c.value2, 60) } : {}),
        modifier: c.modifier,
      };
    case 'rating':
      return {
        value: empty ? 0 : num(c.value, 20),
        ...(two ? { value2: num(c.value2, 20) } : {}),
        modifier: c.modifier,
      };
    case 'number':
    case 'resolution':
      return {
        value: empty ? 0 : num(c.value),
        ...(two ? { value2: num(c.value2) } : {}),
        modifier: c.modifier,
      };
    case 'date':
    case 'timestamp':
      return {
        value: empty ? '' : String(c.value).trim(),
        ...(two ? { value2: String(c.value2 ?? '').trim() } : {}),
        modifier: c.modifier,
      };
    default:
      return { value: empty ? '' : String(c.value), modifier: c.modifier };
  }
}

function nodeToWire(node: Node): FilterNode | null {
  if (node.kind === 'condition')
    return { filter: { [fieldById(node.field).key]: criterion(node) } };
  const group = groupToWire(node);
  return group ? { group } : null;
}

function groupToWire(group: Group): FilterExpression | null {
  const children = group.children
    .map(nodeToWire)
    .filter((c): c is FilterNode => c !== null);
  if (!children.length) return null; // Cove rejects empty groups
  switch (group.op) {
    case 'all':
      return { operator: 'AND', children };
    case 'any':
      return { operator: 'OR', children };
    case 'one':
      return { operator: 'JUST_ONE', children };
    case 'none':
      // NOT takes one child: "none of a, b" = NOT (a OR b)
      return {
        operator: 'NOT',
        children:
          children.length === 1
            ? children
            : [{ group: { operator: 'OR', children } }],
      };
  }
}

/** The filterExpression for Cove's videos/find, or null when the tree has no conditions. */
export function toWire(root: Group): FilterExpression | null {
  return groupToWire(root);
}

// --- Relative dates (Cove's syntax: -7d, -1y3m, +2w, 0d) ------------------------------------------------------

type Part = { amount: number; unit: 'y' | 'm' | 'w' | 'd' | 'h' };

export function parseRelative(
  value: string,
  allowHours: boolean
): { sign: string; parts: Part[] } | null {
  const match = /^([+-]?)((?:\d+[ymwdh])+)$/i.exec(value.trim());
  if (!match) return null;
  const ranks = { y: 5, m: 4, w: 3, d: 2, h: 1 } as const;
  const parts: Part[] = [];
  let previous = Number.POSITIVE_INFINITY;
  for (const m of match[2]!.matchAll(/(\d+)([ymwdh])/gi)) {
    const unit = m[2]!.toLowerCase() as Part['unit'];
    if ((!allowHours && unit === 'h') || ranks[unit] >= previous) return null;
    parts.push({ amount: Number(m[1]), unit });
    previous = ranks[unit];
  }
  const sign = match[1]!;
  if (
    sign === '' &&
    (parts.length !== 1 || parts[0]!.amount !== 0 || parts[0]!.unit !== 'd')
  )
    return null;
  return { sign, parts };
}

export function isRelative(value: unknown): boolean {
  return typeof value === 'string' && /^[+-]|^0d$/i.test(value.trim());
}

/** Resolves an exact or relative date to a Date (relative to now), or null. */
export function resolveDate(value: string, allowHours: boolean): Date | null {
  const relative = parseRelative(value, allowHours);
  if (!relative) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(value.trim())) return null;
    const t = Date.parse(value.trim());
    return Number.isNaN(t) ? null : new Date(t);
  }
  const result = new Date();
  const sign = relative.sign === '-' ? -1 : 1;
  for (const part of relative.parts) {
    const amount = sign * part.amount;
    if (part.unit === 'h') result.setUTCHours(result.getUTCHours() + amount);
    else if (part.unit === 'd' || part.unit === 'w')
      result.setUTCDate(
        result.getUTCDate() + amount * (part.unit === 'w' ? 7 : 1)
      );
    else {
      const day = result.getUTCDate();
      result.setUTCDate(1);
      if (part.unit === 'y')
        result.setUTCFullYear(result.getUTCFullYear() + amount);
      else result.setUTCMonth(result.getUTCMonth() + amount);
      const end = new Date(result);
      end.setUTCMonth(end.getUTCMonth() + 1, 0);
      result.setUTCDate(Math.min(day, end.getUTCDate()));
    }
  }
  return result;
}

function formatDay(value: string, allowHours: boolean): string {
  if (/^0d$/i.test(value.trim())) return 'today';
  const date = resolveDate(value, allowHours);
  if (!date) return value;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/** "-1y" -> "1 year ago", "0d" -> "today", "+2w" -> "in 2 weeks" */
function relativePhrase(value: string): string | null {
  const relative = parseRelative(value, true);
  if (!relative) return null;
  if (relative.sign === '') return 'today';
  const unitNames = { y: 'year', m: 'month', w: 'week', d: 'day', h: 'hour' };
  const text = relative.parts
    .map((p) => `${p.amount} ${unitNames[p.unit]}${p.amount === 1 ? '' : 's'}`)
    .join(' ');
  return relative.sign === '-' ? `${text} ago` : `in ${text}`;
}

// --- Plain language -------------------------------------------------------------------------------------------

function list(values: string[], joiner: 'and' | 'or'): string {
  if (values.length <= 1) return values[0] ?? '';
  return `${values.slice(0, -1).join(', ')} ${joiner} ${values[values.length - 1]}`;
}

function names(c: Condition): string[] {
  return (Array.isArray(c.value) ? c.value : []).map(
    (id) => c.names?.[id] ?? `#${id}`
  );
}

function minutes(v: unknown): string {
  const n = Number(v);
  if (n >= 60 && n % 60 === 0) return `${n / 60} h`;
  return `${n} min`;
}

/** A value as the rows and the sentence show it. */
export function valueText(c: Condition, which: 1 | 2 = 1): string {
  const f = fieldById(c.field);
  const v = which === 1 ? c.value : c.value2;
  switch (f.type) {
    case 'multiId':
      return names(c).join(', ');
    case 'resolution':
      return RESOLUTIONS.find((r) => r.value === Number(v))?.label ?? String(v);
    case 'duration':
      return minutes(v);
    case 'rating':
      return `${v}★`;
    case 'bool':
      return v === true ? 'yes' : 'no';
    case 'orientation':
      return (
        ORIENTATIONS.find((o) => o.value === v)?.label.toLowerCase() ??
        String(v)
      );
    case 'string':
    case 'path':
      return `“${v}”`;
    default:
      return String(v ?? '');
  }
}

const MULTI_VERB: Record<LookupKind, [string, string]> = {
  // [with these, plural noun]
  tags: ['tagged', 'tags'],
  performers: ['with', 'performers'],
  studios: ['from', 'studio'],
  groups: ['in', 'groups'],
  galleries: ['in', 'galleries'],
};

const DATE_VERB: Record<string, string> = {
  createdAt: 'added',
  date: 'dated',
  updatedAt: 'updated',
  lastPlayedAt: 'last played',
};

function dateValue(v: unknown): string {
  const s = String(v ?? '');
  return relativePhrase(s) ?? formatDay(s, true);
}

/** One condition in plain words: "tagged Drone and Landscape", "added in the last year", "over 20 min". */
export function describeCondition(c: Condition): string {
  const f = fieldById(c.field);
  const m = c.modifier;
  // The Library's built-in shortcuts (1f): play count 0, a resume position
  if (f.id === 'playCount' && m === 'equals' && Number(c.value) === 0)
    return 'unwatched';
  if (f.id === 'resumeTime' && m === 'greaterThan' && Number(c.value) === 0)
    return 'in progress';
  if (f.type === 'path') {
    // Design 3c / 5a: "in Drone/2024", "not in Family", "“GoPro” in path"
    if (m === 'underPath') return `in ${shortFolder(c)}`;
    if (m === 'notUnderPath') return `not in ${shortFolder(c)}`;
    if (m === 'includes') return `“${c.value}” in path`;
    if (m === 'matchesRegex') return `with a path matching ${c.value}`;
  }
  if (f.type === 'multiId' && f.lookup) {
    const [verb, plural] = MULTI_VERB[f.lookup];
    const n = names(c);
    switch (m) {
      case 'includes':
        return `${verb} ${list(n, 'or')}`;
      case 'includesAll':
        return `${verb} ${list(n, 'and')}`;
      case 'excludes':
        return `not ${verb} ${list(n, 'or')}`;
      case 'excludesAll':
        return `not ${verb} all of ${list(n, 'and')}`;
      case 'isNull':
        return `with no ${plural}`;
      default:
        return `with any ${plural}`;
    }
  }
  if (f.type === 'date' || f.type === 'timestamp') {
    const verb = DATE_VERB[f.id] ?? f.label.toLowerCase();
    const a = String(c.value ?? '');
    const b = String(c.value2 ?? '');
    switch (m) {
      case 'between': {
        // "-1y" … "0d": "in the last year"
        const since = parseRelative(a, true);
        if (since?.sign === '-' && /^0d$/i.test(b.trim())) {
          const phrase = relativePhrase(a)!.replace(/ ago$/, '');
          return `${verb} in the last ${phrase.replace(/^1 /, '')}`;
        }
        return `${verb} between ${dateValue(a)} and ${dateValue(b)}`;
      }
      case 'notBetween':
        return `not ${verb} between ${dateValue(a)} and ${dateValue(b)}`;
      case 'greaterThan':
        return `${verb} after ${dateValue(a)}`;
      case 'lessThan':
        return `${verb} before ${dateValue(a)}`;
      case 'equals':
        return `${verb} on ${dateValue(a)}`;
      case 'notEquals':
        return `not ${verb} on ${dateValue(a)}`;
      case 'isNull':
        return f.id === 'lastPlayedAt'
          ? 'never played'
          : `with no ${f.label.toLowerCase()}`;
      default:
        return f.id === 'lastPlayedAt'
          ? 'played before'
          : `with a ${f.label.toLowerCase()}`;
    }
  }
  if (f.type === 'resolution') {
    const v = valueText(c);
    return (
      {
        equals: v,
        notEquals: `not ${v}`,
        greaterThan: `above ${v}`,
        lessThan: `below ${v}`,
      }[m as 'equals'] ?? v
    );
  }
  if (f.type === 'duration' && f.id === 'duration') {
    const a = valueText(c);
    const b = valueText(c, 2);
    switch (m) {
      case 'greaterThan':
        return `over ${a}`;
      case 'lessThan':
        return `under ${a}`;
      case 'between':
        return `${a}–${b} long`;
      case 'notBetween':
        return `not ${a}–${b} long`;
      case 'notEquals':
        return `not ${a} long`;
      default:
        return `${a} long`;
    }
  }
  if (f.type === 'bool')
    return c.value === true
      ? f.label.toLowerCase()
      : `not ${f.label.toLowerCase()}`;
  if (f.type === 'orientation')
    return m === 'notEquals' ? `not ${valueText(c)}` : valueText(c);
  // Cove's own phrasing (filterExpressionExplanation.ts), with a lowercase field
  const label = f.label.toLowerCase();
  const a = valueText(c);
  const b = valueText(c, 2);
  switch (m) {
    case 'equals':
      return `${label} is ${a}`;
    case 'notEquals':
      return `${label} is not ${a}`;
    case 'greaterThan':
      return `${label} is greater than ${a}`;
    case 'lessThan':
      return `${label} is less than ${a}`;
    case 'between':
      return `${label} is between ${a} and ${b}`;
    case 'notBetween':
      return `${label} is not between ${a} and ${b}`;
    case 'includes':
      return `${label} includes ${a}`;
    case 'excludes':
      return `${label} excludes ${a}`;
    case 'matchesRegex':
      return `${label} matches the pattern ${a}`;
    case 'notMatchesRegex':
      return `${label} does not match the pattern ${a}`;
    case 'isNull':
      return `${label} is not set`;
    case 'notNull':
      return `${label} is set`;
    case 'underPath':
      return `${label} is under ${a}`;
    case 'notUnderPath':
      return `${label} is not under ${a}`;
    default:
      return `${label} ${a}`;
  }
}

// --- The summary (design 5a): at most three short lines ------------------------------------------------------------

/** A piece of a summary line; a group token opens that group. */
export type SummaryRun =
  | { kind: 'lead' | 'word' | 'text'; text: string }
  | { kind: 'group'; group: Group; text: string }
  | { kind: 'more'; count: number };

// About what fits on one 13.5px line of a phone; a token counts its icon and padding.
const LINE_BUDGET = 48;
const REPEATABLE = ['tagged', 'with', 'from', 'in', 'added', 'over', 'under'];
const LINE_WORDS: Record<GroupOp, string> = {
  all: 'and',
  any: 'or',
  one: 'or',
  none: 'nor',
};

const text = (t: string): SummaryRun => ({ kind: 'text', text: t });

function runsLength(runs: SummaryRun[]): number {
  return runs.reduce(
    (n, r) =>
      n +
      (r.kind === 'more'
        ? 8
        : r.kind === 'group'
          ? r.text.length + 5
          : r.text.length),
    0
  );
}

/** A group as a token: "all of 5". */
export function groupToken(group: Group): SummaryRun {
  return {
    kind: 'group',
    group,
    text: `${GROUP_LABELS[group.op].toLowerCase()} ${conditionCount(group)}`,
  };
}

/** "a, b or c", with each part a list of runs. */
function listRuns(parts: SummaryRun[][], joiner: string): SummaryRun[] {
  return parts.flatMap((p, i) =>
    i === 0 ? p : [text(i === parts.length - 1 ? ` ${joiner} ` : ', '), ...p]
  );
}

/** A group spelled out one level down: its conditions in words, its own subgroups as tokens. */
export function groupPhrase(group: Group): SummaryRun[] {
  let verb = '';
  const parts = group.children.flatMap((c): SummaryRun[][] => {
    if (c.kind !== 'condition') {
      verb = '';
      return conditionCount(c) ? [[groupToken(c)]] : [];
    }
    // "tagged Blurry nor Rejected": a verb the previous condition just used goes
    const phrase = describeCondition(c);
    const first = phrase.split(' ')[0]!;
    const repeated = first === verb && REPEATABLE.includes(first);
    verb = first;
    return [[text(repeated ? phrase.slice(first.length + 1) : phrase)]];
  });
  if (!parts.length) return [];
  if (parts.length === 1)
    return group.op === 'none' ? [text('not '), ...parts[0]!] : parts[0]!;
  switch (group.op) {
    case 'all':
      return listRuns(parts, 'and');
    case 'any':
      return listRuns(parts, 'or');
    case 'one':
      return parts.length === 2
        ? [
            text('either '),
            ...parts[0]!,
            text(' or '),
            ...parts[1]!,
            text(', not both'),
          ]
        : [text('exactly one of '), ...listRuns(parts, 'or')];
    case 'none':
      return parts.length === 2
        ? [text('neither '), ...parts[0]!, text(' nor '), ...parts[1]!]
        : [text('none of '), ...listRuns(parts, 'or')];
  }
}

/** Runs as plain text (tokens by their words). */
export function runsText(runs: SummaryRun[]): string {
  return runs
    .map((r) => (r.kind === 'more' ? `+ ${r.count} more` : r.text))
    .join('');
}

/**
 * A group as its summary lines (design 5a): its conditions on the first line after its operator ("All of: tagged
 * Drone · 4K"); a line per subgroup, starting with the group's word ("and 4K or {all of 5}"); deeper groups as tokens.
 * Short of `full`, three lines at most: whole items that don't fit fold into "+ N more", never mid-phrase.
 */
export function outline(group: Group, full = false): SummaryRun[][] {
  let more = 0;
  const first: SummaryRun[] = [
    { kind: 'lead', text: `${GROUP_LABELS[group.op]}:` },
  ];
  let conditions = 0;
  for (const c of group.children) {
    if (c.kind !== 'condition') continue;
    const piece = text(`${conditions ? ' · ' : ' '}${describeCondition(c)}`);
    if (
      !full &&
      conditions &&
      runsLength(first) + runsLength([piece]) > LINE_BUDGET
    )
      more++;
    else {
      first.push(piece);
      conditions++;
    }
  }
  const lines: SummaryRun[][] = [first];
  let firstTaken = conditions > 0;
  for (const g of group.children) {
    if (g.kind !== 'group' || !conditionCount(g)) continue;
    let phrase = groupPhrase(g);
    if (!full && runsLength(phrase) + 4 > LINE_BUDGET) phrase = [groupToken(g)];
    if (!firstTaken) first.push(text(' '), ...phrase);
    else
      lines.push([
        { kind: 'word', text: `${LINE_WORDS[group.op]} ` },
        ...phrase,
      ]);
    firstTaken = true;
  }
  if (first.length === 1) return [];
  if (full) return lines;
  if (lines.length > 3) more += lines.splice(3).length;
  if (more) {
    const last = lines[lines.length - 1]!;
    const tag: SummaryRun = { kind: 'more', count: more };
    if (runsLength(last) + 11 <= LINE_BUDGET) last.push(text(' · '), tag);
    else if (lines.length < 3) lines.push([tag]);
    else lines[2] = [{ kind: 'more', count: more + 1 }];
  }
  return lines;
}

// --- Rows -----------------------------------------------------------------------------------------------------

export const MODIFIER_LABELS: Record<Modifier, string> = {
  equals: 'is',
  notEquals: 'is not',
  greaterThan: 'greater than',
  lessThan: 'less than',
  between: 'between',
  notBetween: 'not between',
  includes: 'includes',
  includesAll: 'includes all',
  excludes: 'excludes',
  excludesAll: 'excludes all',
  isNull: 'is not set',
  notNull: 'is set',
  matchesRegex: 'matches regex',
  notMatchesRegex: "doesn't match regex",
  underPath: 'is under',
  notUnderPath: 'is not under',
};

/** Operators as 2b's rows show them: "=" for single values, words otherwise. */
function rowOperator(f: Field, m: Modifier): string {
  if (
    m === 'equals' &&
    f.type !== 'multiId' &&
    f.type !== 'string' &&
    f.type !== 'path'
  )
    return '=';
  if (
    m === 'notEquals' &&
    f.type !== 'multiId' &&
    f.type !== 'string' &&
    f.type !== 'path'
  )
    return '≠';
  return MODIFIER_LABELS[m];
}

/**
 * A run of a row's second line: muted (operator words), mono (relative dates, path text) or plain (values); folder:
 * a folder icon, sep: a caret between folder names.
 */
export interface RowRun {
  text: string;
  muted?: boolean;
  mono?: boolean;
  folder?: boolean;
  sep?: boolean;
}

/** A condition row: field label, "operator value" runs, and a resolved date range for relative dates. */
export function rowText(c: Condition): {
  label: string;
  runs: RowRun[];
  resolved?: string;
  resolvedMono?: boolean;
} {
  const f = fieldById(c.field);
  if (f.type === 'path') {
    // Design 3c: "in folder" + folder + its last names, the full path below.
    if (isFolderMatch(c.modifier)) {
      const chain = c.folder?.chain;
      const shown = chain?.length
        ? (chain.length > 1 ? chain.slice(1) : chain)
            .slice(-2)
            .map((x) => x.name)
        : shortFolder(c).split('/');
      const runs: RowRun[] = [
        {
          text: c.modifier === 'underPath' ? 'in folder' : 'not in folder',
          muted: true,
        },
        { text: ' ' },
        { text: '', folder: true },
        { text: ' ' },
      ];
      shown.forEach((name, i) => {
        if (i) runs.push({ text: ' ' }, { text: '', sep: true }, { text: ' ' });
        runs.push({ text: name });
      });
      const subfolders = c.folder?.subfolders ?? 0;
      return {
        label: f.label,
        runs,
        resolved: `${String(c.value)}${subfolders ? ` · and ${subfolders} subfolder${subfolders === 1 ? '' : 's'}` : ''}`,
        resolvedMono: true,
      };
    }
    // Text matches (and any other operator a condition may carry).
    const words =
      c.modifier === 'includes' ? 'contains' : MODIFIER_LABELS[c.modifier];
    return {
      label: f.label,
      runs: needsValue(c.modifier)
        ? [
            { text: words, muted: true },
            { text: ' ' },
            { text: String(c.value), mono: true },
          ]
        : [{ text: words, muted: true }],
    };
  }
  const op = rowOperator(f, c.modifier);
  if (NO_VALUE.includes(c.modifier))
    return { label: f.label, runs: [{ text: op, muted: true }] };
  if (f.type === 'bool')
    return {
      label: f.label,
      runs: [{ text: '=', muted: true }, { text: ` ${valueText(c)}` }],
    };
  const dated = f.type === 'date' || f.type === 'timestamp';
  const run = (which: 1 | 2): RowRun => {
    const raw = which === 1 ? c.value : c.value2;
    if (dated && isRelative(raw)) return { text: String(raw), mono: true };
    return { text: dated ? String(raw ?? '') : valueText(c, which) };
  };
  const runs: RowRun[] = [{ text: op, muted: true }, { text: ' ' }, run(1)];
  if (TWO_VALUES.includes(c.modifier))
    runs.push({ text: ' and ', muted: true }, run(2));
  let resolved: string | undefined;
  if (dated && (isRelative(c.value) || isRelative(c.value2))) {
    const allowHours = f.type === 'timestamp';
    const a = formatDay(String(c.value ?? ''), allowHours);
    resolved = TWO_VALUES.includes(c.modifier)
      ? `${a} – ${formatDay(String(c.value2 ?? ''), allowHours)}`
      : a;
  }
  return { label: f.label, runs, resolved };
}

// --- Editing --------------------------------------------------------------------------------------------------

export function needsValue(m: Modifier): boolean {
  return !NO_VALUE.includes(m);
}

export function needsTwoValues(m: Modifier): boolean {
  return TWO_VALUES.includes(m);
}

/** A new condition for a field, with its first modifier and a default value. */
export function newCondition(fieldId: string): Condition {
  const f = fieldById(fieldId);
  const base = {
    kind: 'condition' as const,
    id: newId(),
    field: f.id,
    modifier: f.modifiers[0]!,
  };
  switch (f.type) {
    case 'multiId':
      return { ...base, value: [], names: {} };
    case 'resolution':
      return { ...base, modifier: 'equals', value: 2160 };
    case 'duration':
      return { ...base, value: 20, value2: 60 };
    case 'rating':
      return { ...base, value: 3, value2: 5 };
    case 'number':
      return { ...base, value: 0, value2: 0 };
    case 'date':
    case 'timestamp':
      return { ...base, value: '-1y', value2: '0d' };
    case 'bool':
      return { ...base, value: true };
    case 'orientation':
      return { ...base, value: 'landscape' };
    case 'path':
      return { ...base, modifier: 'underPath', value: '' };
    default:
      return { ...base, value: '' };
  }
}

/** Why the condition can't be used yet, or null when it's complete. */
export function validate(c: Condition): string | null {
  const f = fieldById(c.field);
  if (!needsValue(c.modifier)) return null;
  const two = needsTwoValues(c.modifier);
  const finite = (v: unknown) =>
    v !== '' && v !== undefined && Number.isFinite(Number(v));
  switch (f.type) {
    case 'multiId':
      return Array.isArray(c.value) && c.value.length
        ? null
        : `Pick at least one ${f.label.toLowerCase()}.`;
    case 'duration':
    case 'rating':
    case 'number':
      if (!finite(c.value) || (two && !finite(c.value2)))
        return 'Enter a number.';
      return null;
    case 'date':
    case 'timestamp': {
      const ok = (v: unknown) =>
        typeof v === 'string' &&
        resolveDate(v, f.type === 'timestamp') !== null;
      if (!ok(c.value) || (two && !ok(c.value2)))
        return 'Use a date (2025-10-04) or a relative date (-7d, -1y3m, 0d).';
      return null;
    }
    case 'string':
    case 'path':
      if (f.type === 'path' && isFolderMatch(c.modifier))
        return String(c.value).trim() ? null : 'Choose a folder.';
      if (String(c.value).trim() === '') return 'Enter some text.';
      if (c.modifier === 'matchesRegex' || c.modifier === 'notMatchesRegex') {
        try {
          RegExp(String(c.value));
        } catch {
          return 'That is not a valid regular expression.';
        }
      }
      return null;
    default:
      return null;
  }
}
