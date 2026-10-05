// Saved filters as Cove's web UI stores them (ui/src/components/SavedFilterMenu.tsx): objectFilter is the page's
// filter state as JSON, flat criteria plus the rule tree under "_filterExpression", with modifiers and operators in
// the UI's SCREAMING_CASE ("INCLUDES_ALL", "JUST_ONE"); uiOptions has the display mode. This reads them into the rule
// tree of filter/model and writes the tree back the same way, so the web UI keeps reading what the app saves.

import type { FilterExpression, FilterNode, SavedFilter } from '../api/types';
import {
  FIELDS,
  newId,
  toWire,
  type Condition,
  type Group,
  type GroupOp,
  type Modifier,
  type Node,
} from './model';

const TREE_KEY = '_filterExpression';
// Page state in objectFilter that is not a criterion (Cove's compilation toggle).
const STATE_KEYS = ['includeCompilationGroups'];

const OPS: Record<string, GroupOp> = {
  and: 'all',
  or: 'any',
  just_one: 'one',
  justone: 'one',
  not: 'none',
};

/** "INCLUDES_ALL" or "includesAll" -> "includesAll" (what videos/find takes). */
function camelModifier(m: unknown): Modifier {
  const s = String(m ?? '');
  if (!s.includes('_') && s !== s.toUpperCase()) return s as Modifier;
  return s
    .toLowerCase()
    .replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase()) as Modifier;
}

/** "includesAll" -> "INCLUDES_ALL" (what the web UI stores). */
function screamingModifier(m: string): string {
  return m.replace(/([A-Z])/g, '_$1').toUpperCase();
}

const num = (v: unknown, scale = 1) => {
  const n = Number(v) / scale;
  return Math.round(n * 100) / 100;
};

/** One criterion ({ value, value2?, modifier }) as a condition, or null for one the app doesn't know. */
function toCondition(key: string, raw: unknown): Condition | null {
  const field = FIELDS.find((f) => f.key === key);
  if (!field || !raw || typeof raw !== 'object') return null;
  const crit = raw as Record<string, unknown>;
  const modifier = camelModifier(crit.modifier ?? 'equals');
  const base = { kind: 'condition' as const, id: newId(), field: field.id };
  switch (field.type) {
    case 'multiId': {
      // Ids, or { id, label } objects
      const items = Array.isArray(crit.value) ? crit.value : [];
      const ids: number[] = [];
      const names: Record<number, string> = {};
      for (const item of items) {
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>;
          const id = Number(o.id);
          ids.push(id);
          if (o.label ?? o.name) names[id] = String(o.label ?? o.name);
        } else ids.push(Number(item));
      }
      // Excluded ids and sub-tag depth aren't in the app's model
      if (Array.isArray(crit.excludes) && crit.excludes.length) return null;
      return { ...base, modifier, value: ids, names };
    }
    case 'bool':
      return { ...base, modifier: 'equals', value: crit.value === true };
    case 'duration':
      return {
        ...base,
        modifier,
        value: num(crit.value, 60),
        ...(crit.value2 != null ? { value2: num(crit.value2, 60) } : {}),
      };
    case 'rating':
      return {
        ...base,
        modifier,
        value: num(crit.value, 20),
        ...(crit.value2 != null ? { value2: num(crit.value2, 20) } : {}),
      };
    case 'number':
    case 'resolution':
      return {
        ...base,
        modifier,
        value: Number(crit.value ?? 0),
        ...(crit.value2 != null ? { value2: Number(crit.value2) } : {}),
      };
    default:
      return {
        ...base,
        modifier,
        value: String(crit.value ?? ''),
        ...(crit.value2 != null ? { value2: String(crit.value2) } : {}),
      };
  }
}

interface Parsed {
  nodes: Node[];
  dropped: number;
}

/** A filter leaf ({ key: criterion, ... }): one condition per criterion. */
function fromFilter(filter: Record<string, unknown>): Parsed {
  const nodes: Node[] = [];
  let dropped = 0;
  for (const [key, crit] of Object.entries(filter)) {
    const c = toCondition(key, crit);
    if (c) nodes.push(c);
    else dropped++;
  }
  return { nodes, dropped };
}

function fromExpression(expr: Record<string, unknown>): Parsed {
  const op = OPS[String(expr.operator ?? 'AND').toLowerCase()];
  // Related-record blocks ("the same performer") aren't in the app's model
  if (!op || expr.relatedScope || expr.distinctRelatedMatches)
    return { nodes: [], dropped: 1 };
  const children: Node[] = [];
  let dropped = 0;
  for (const child of (expr.children as FilterNode[] | undefined) ?? []) {
    let parsed: Parsed;
    if ('group' in child) {
      parsed = fromExpression(
        child.group as unknown as Record<string, unknown>
      );
    } else {
      parsed = fromFilter(child.filter);
      // Several criteria in one leaf all apply: in an Any of / Just one of group they stay together.
      if (parsed.nodes.length > 1 && op !== 'all')
        parsed.nodes = [
          { kind: 'group', id: newId(), op: 'all', children: parsed.nodes },
        ];
    }
    children.push(...parsed.nodes);
    dropped += parsed.dropped;
  }
  // NOT takes one child: "NOT (a OR b)" is None of a, b.
  if (op === 'none' && children.length === 1) {
    const only = children[0]!;
    if (only.kind === 'group' && only.op === 'any')
      return {
        nodes: [{ ...only, op: 'none' }],
        dropped,
      };
  }
  return { nodes: [{ kind: 'group', id: newId(), op, children }], dropped };
}

const parseJson = (s: string | null): Record<string, unknown> => {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export interface LoadedFilter {
  tree: Group;
  /** Criteria or blocks the app can't show; the filter still runs whole (see wire). */
  dropped: number;
  /** What videos/find gets: the whole saved filter, modifiers as the API takes them. */
  wire: FilterExpression | null;
  /** The saved display mode as the Library's view, if it has one */
  view: 'list' | 'grid' | null;
  /** The saved search text (findFilter.q), '' for none */
  q: string;
}

/** A criterion with its modifier in camelCase (the API rejects "NOT_EQUALS"). */
const fix = (crit: unknown) =>
  crit && typeof crit === 'object' && 'modifier' in (crit as object)
    ? {
        ...(crit as object),
        modifier: camelModifier((crit as Record<string, unknown>).modifier),
      }
    : crit;

/** A stored tree with every modifier in camelCase; anything else on a group (relatedScope) stays. */
function normalizeWire(expr: Record<string, unknown>): FilterExpression {
  return {
    ...expr,
    operator: String(
      expr.operator ?? 'AND'
    ).toUpperCase() as FilterExpression['operator'],
    children: ((expr.children as FilterNode[] | undefined) ?? []).map(
      (child) =>
        'group' in child
          ? {
              group: normalizeWire(
                child.group as unknown as Record<string, unknown>
              ),
            }
          : {
              filter: Object.fromEntries(
                Object.entries(child.filter).map(([k, v]) => [k, fix(v)])
              ),
            }
    ),
  };
}

/** A saved filter as the rule tree, what to query with, and its view. */
export function loadSavedFilter(saved: SavedFilter): LoadedFilter {
  const object = parseJson(saved.objectFilter);
  const flat = Object.fromEntries(
    Object.entries(object).filter(
      ([k]) => k !== TREE_KEY && !STATE_KEYS.includes(k)
    )
  );
  const expr = object[TREE_KEY] as Record<string, unknown> | undefined;
  const top = fromFilter(flat);
  const children = [...top.nodes];
  let dropped = top.dropped;
  if (expr) {
    const parsed = fromExpression(expr);
    dropped += parsed.dropped;
    // An All of tree merges into the root (flat criteria and tree are ANDed)
    for (const node of parsed.nodes) {
      if (node.kind === 'group' && node.op === 'all')
        children.push(...node.children);
      else children.push(node);
    }
  }
  const tree: Group = { kind: 'group', id: newId(), op: 'all', children };

  // The query: the parsed tree when it is whole, else the saved filter itself
  let wire = toWire(tree);
  if (dropped) {
    const parts: FilterNode[] = Object.entries(flat).map(([k, v]) => ({
      filter: { [k]: fix(v) },
    }));
    if (expr) parts.push({ group: normalizeWire(expr) });
    wire = parts.length ? { operator: 'AND', children: parts } : null;
  }

  const mode = String(parseJson(saved.uiOptions).displayMode ?? '');
  const view =
    mode === 'list' || mode === 'feed' ? 'list' : mode ? 'grid' : null;
  const q = String(parseJson(saved.findFilter).q ?? '');
  return { tree, dropped, wire, view, q };
}

/** The tree in the web UI's format (SCREAMING modifiers), for objectFilter._filterExpression. */
function toStored(expr: FilterExpression): FilterExpression {
  return {
    operator: expr.operator,
    children: expr.children.map((child) =>
      'group' in child
        ? { group: toStored(child.group) }
        : {
            filter: Object.fromEntries(
              Object.entries(child.filter).map(([k, crit]) => {
                const c = crit as Record<string, unknown>;
                return [
                  k,
                  typeof c.modifier === 'string'
                    ? { ...c, modifier: screamingModifier(c.modifier) }
                    : c,
                ];
              })
            ),
          }
    ),
  };
}

/** The display mode to store for a view, keeping a stored one of the same kind ("feed" for a list, "wall" for a grid). */
function displayModeFor(view: 'list' | 'grid', stored: string): string {
  if (view === 'list')
    return stored === 'feed' || stored === 'list' ? stored : 'list';
  return stored && stored !== 'list' && stored !== 'feed' ? stored : 'grid';
}

/**
 * The change to save: the tree as the whole objectFilter (flat criteria were read into it; page state is kept), the
 * search in findFilter and the view in uiOptions (their other settings kept).
 */
export function savedFilterChange(
  saved: SavedFilter,
  tree: Group,
  view: 'list' | 'grid',
  q: string
): { findFilter: string; objectFilter: string; uiOptions: string } {
  const object = parseJson(saved.objectFilter);
  const state = Object.fromEntries(
    Object.entries(object).filter(([k]) => STATE_KEYS.includes(k))
  );
  const wire = toWire(tree);
  const ui = parseJson(saved.uiOptions);
  return {
    findFilter: JSON.stringify({ ...parseJson(saved.findFilter), q: q.trim() }),
    objectFilter: JSON.stringify({
      ...state,
      ...(wire ? { [TREE_KEY]: toStored(wire) } : {}),
    }),
    uiOptions: JSON.stringify({
      ...ui,
      displayMode: displayModeFor(view, String(ui.displayMode ?? '')),
    }),
  };
}

/** A new saved filter (Save as…): the tree, the search, the app's sort (newest first) and the view. */
export function newSavedFilter(
  name: string,
  tree: Group,
  view: 'list' | 'grid',
  q: string
): Omit<SavedFilter, 'id'> {
  const wire = toWire(tree);
  return {
    mode: 'videos',
    name: name.trim(),
    findFilter: JSON.stringify({
      q: q.trim(),
      page: 1,
      perPage: 40,
      sort: 'created_at',
      direction: 'desc',
    }),
    objectFilter: JSON.stringify(wire ? { [TREE_KEY]: toStored(wire) } : {}),
    uiOptions: JSON.stringify({ displayMode: displayModeFor(view, '') }),
  };
}
