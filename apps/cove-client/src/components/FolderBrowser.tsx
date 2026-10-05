import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CoveError, type CoveClient } from '../api/cove';
import type { FilterExpression, LibraryFolder } from '../api/types';
import { folderChain, type FolderRef } from '../filter/model';
import { fonts, nocturne as n } from '../theme/tokens';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';
import { BackButton } from '../ui/IconButton';

/** What a folder pick hands back: the folders from the library root down to it, and its subfolder count. */
export interface FolderPick {
  chain: FolderRef[];
  subfolders: number;
}

const fmt = (count: number) => count.toLocaleString('en-US');

/** A filter of the videos in a folder and the folders inside it (for counts). */
export function inFolder(path: string): FilterExpression {
  return {
    operator: 'AND',
    children: [
      { filter: { pathCriterion: { value: path, modifier: 'underPath' } } },
    ],
  };
}

/** Video counts per folder path, fetched once each while the sheet is open. */
function useFolderCounts(client: CoveClient, paths: string[]) {
  const cache = useRef(new Map<string, number | null>());
  const [, setVersion] = useState(0);
  const key = paths.join('\n');
  useEffect(() => {
    let current = true;
    for (const path of key ? key.split('\n') : []) {
      if (cache.current.has(path)) continue;
      cache.current.set(path, null);
      client.countVideos(inFolder(path)).then(
        (count) => {
          cache.current.set(path, count);
          if (current) setVersion((v) => v + 1);
        },
        () => {}
      );
    }
    return () => {
      current = false;
    };
  }, [client, key]);
  return (path: string) => cache.current.get(path) ?? null;
}

function host(server: string): string {
  return server.replace(/^[a-z]+:\/\//i, '').replace(/[/:].*$/, '');
}

/**
 * Design 3b: Cove's library folders, from the roots down. A folder with subfolders opens on a tap, one without is
 * selected; the footer picks the selection, else the folder being shown.
 */
export function FolderBrowser({
  client,
  start,
  onPick,
  onBack,
  onType,
}: {
  client: CoveClient;
  /** The folder to show first (the current pick), root first; empty: the library roots */
  start: FolderRef[];
  onPick: (pick: FolderPick) => void;
  onBack: () => void;
  /** The typed path editor (3d); noAccess: this account may not list folders */
  onType: (noAccess: boolean) => void;
}) {
  const [chain, setChain] = useState<FolderRef[]>(start);
  const [list, setList] = useState<LibraryFolder[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const current = chain[chain.length - 1];

  useEffect(() => {
    let live = true;
    setList(null);
    setError('');
    client.libraryFolders(current?.path).then(
      (folders) => live && setList(folders),
      (e) => {
        if (!live) return;
        if (e instanceof CoveError && e.status === 403 && !current)
          onType(true);
        else setError(e instanceof Error ? e.message : String(e));
      }
    );
    return () => {
      live = false;
    };
  }, [client, current, onType]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (list ?? []).filter(
      (f) => !needle || f.name.toLowerCase().includes(needle)
    );
  }, [list, q]);
  const countOf = useFolderCounts(client, [
    ...visible.map((f) => f.path),
    ...(current ? [current.path] : []),
  ]);

  const open = (folder: LibraryFolder) => {
    setChain([...chain, { name: folder.name, path: folder.path }]);
    setSelected(null);
    setQ('');
  };
  const atRoot = chain.length === 0;
  const pick = selected ? visible.find((f) => f.path === selected) : undefined;
  const target: FolderRef | undefined = pick ?? current;
  const targetChain = pick
    ? [...chain, { name: pick.name, path: pick.path }]
    : chain;
  const subfolders = pick ? 0 : (list?.length ?? 0);
  const targetCount = target ? countOf(target.path) : null;

  return (
    <View style={styles.fill}>
      <View style={styles.header}>
        <BackButton onPress={onBack} />
        <Text style={styles.title}>Choose a folder</Text>
        <Pressable onPress={() => onType(false)} style={styles.typeLink}>
          <Icon name="cursor-text" size={16} color={n.accent300} />
          <Text style={styles.typeText}>Type path</Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.crumbs}
        contentContainerStyle={styles.crumbsContent}
      >
        {[{ name: 'Library', path: '' }, ...chain].map((c, i, all) => (
          <View key={c.path || 'library'} style={styles.crumbItem}>
            {i ? (
              <Icon name="caret-right" size={11} color={n.textAlpha(45)} />
            ) : null}
            <Pressable
              onPress={() => {
                setChain(chain.slice(0, i));
                setSelected(null);
                setQ('');
              }}
              style={styles.crumb}
            >
              {i === 0 ? (
                <Icon
                  name="hard-drives"
                  size={15}
                  color={i === all.length - 1 ? n.accent300 : n.textAlpha(55)}
                />
              ) : null}
              <Text
                style={[
                  styles.crumbText,
                  i === all.length - 1 && styles.crumbCurrent,
                ]}
              >
                {c.name}
              </Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>

      <View style={styles.searchWrap}>
        <View style={styles.search}>
          <Icon name="magnifying-glass" size={16} color={n.textAlpha(55)} />
          <TextInput
            value={q}
            onChangeText={(t) => {
              setQ(t);
              setSelected(null);
            }}
            placeholder={
              atRoot
                ? 'Filter library folders'
                : `Filter folders in ${current?.name}`
            }
            placeholderTextColor={n.textAlpha(40)}
            style={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>
      </View>

      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
      >
        {atRoot ? (
          <Text style={styles.section}>
            Library folders on {host(client.server)}
          </Text>
        ) : null}
        {visible.map((folder) => {
          const on = selected === folder.path;
          const count = countOf(folder.path);
          const videos = count == null ? '… videos' : `${fmt(count)} videos`;
          return (
            <Pressable
              key={folder.path}
              onPress={() =>
                folder.hasChildren
                  ? open(folder)
                  : setSelected(on ? null : folder.path)
              }
              style={[styles.row, on && styles.rowOn]}
            >
              <View style={styles.tile}>
                <Icon
                  name={atRoot ? 'hard-drives' : 'folder'}
                  fill={on}
                  size={20}
                  color={n.accent}
                />
              </View>
              <View style={styles.rowBody}>
                <Text
                  style={[styles.rowName, on && styles.rowNameOn]}
                  numberOfLines={1}
                >
                  {folder.name}
                </Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {atRoot ? `${folder.path} · ${videos}` : videos}
                </Text>
              </View>
              {folder.hasChildren ? (
                <Icon name="caret-right" size={16} color={n.textAlpha(45)} />
              ) : (
                <View style={[styles.radio, on && styles.radioOn]}>
                  {on ? <View style={styles.radioDot} /> : null}
                </View>
              )}
            </Pressable>
          );
        })}
        {list && !visible.length ? (
          <Text style={styles.empty}>
            {q
              ? `No folder here matches “${q}”.`
              : 'No folders inside this one.'}
          </Text>
        ) : null}
        {!list && !error ? (
          <Text style={styles.empty}>Loading folders…</Text>
        ) : null}
        {error ? <Text style={styles.empty}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.hintRow}>
          <Icon name="tree-structure" size={14} color={n.textAlpha(55)} />
          <Text style={styles.hint} numberOfLines={1}>
            {target
              ? `${target.path}${subfolders ? ` · and its ${subfolders} subfolder${subfolders === 1 ? '' : 's'}` : ''}`
              : 'Pick a library folder to start'}
          </Text>
        </View>
        <Button
          label={
            target
              ? `Use “${target.name}”${targetCount == null ? '' : ` · ${fmt(targetCount)} videos`}`
              : 'Choose a folder'
          }
          size="lg"
          disabled={!target}
          onPress={() => target && onPick({ chain: targetChain, subfolders })}
        />
      </View>
    </View>
  );
}

/**
 * Design 3d: a path typed in, for accounts that can't browse folders (then a banner says so) and for anyone who'd
 * rather type. Suggests the folders under the typed parent and says whether the folder exists.
 */
export function TypedPath({
  client,
  noAccess: initialNoAccess,
  initial,
  onPick,
  onBack,
}: {
  client: CoveClient;
  noAccess: boolean;
  initial: string;
  onPick: (pick: FolderPick) => void;
  onBack: () => void;
}) {
  const [text, setText] = useState(initial);
  const [noAccess, setNoAccess] = useState(initialNoAccess);
  const [roots, setRoots] = useState<LibraryFolder[]>([]);
  const [siblings, setSiblings] = useState<LibraryFolder[]>([]); // the folders next to the typed one
  const [children, setChildren] = useState<LibraryFolder[]>([]); // the folders under the typed parent
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (noAccess) return;
    client.libraryFolders().then(setRoots, (e) => {
      if (e instanceof CoveError && e.status === 403) setNoAccess(true);
    });
  }, [client, noAccess]);

  const trimmed = text.trim();
  const normalized = trimmed.replace(/[\\/]+$/, '');
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  const parent = cut > 0 ? trimmed.slice(0, cut) : '';
  const partial = trimmed.slice(cut + 1).toLowerCase();
  const normalizedCut = Math.max(
    normalized.lastIndexOf('/'),
    normalized.lastIndexOf('\\')
  );
  const normalizedParent =
    normalizedCut > 0 ? normalized.slice(0, normalizedCut) : '';
  const inside = (p: string) =>
    roots.some((r) => {
      const base = r.path.replace(/[\\/]+$/, '').toLowerCase();
      const low = p.toLowerCase();
      return (
        low === base ||
        low.startsWith(base + '/') ||
        low.startsWith(base + '\\')
      );
    });

  // The folders under the parent (suggestions) and next to the typed folder (does it exist?).
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      const list = (p: string, set: (f: LibraryFolder[]) => void) =>
        p && inside(p)
          ? client.libraryFolders(p).then(
              (f) => live && set(f),
              () => live && set([])
            )
          : set([]);
      if (noAccess) return;
      list(parent, setChildren);
      list(normalizedParent, setSiblings);
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, parent, normalizedParent, noAccess, roots]);

  const exact =
    roots.find(
      (r) =>
        r.path.replace(/[\\/]+$/, '').toLowerCase() === normalized.toLowerCase()
    ) ??
    siblings.find((f) => f.path.toLowerCase() === normalized.toLowerCase());
  const exactPath = exact?.path ?? null;
  useEffect(() => {
    let live = true;
    setCount(null);
    const path = noAccess ? normalized || null : exactPath;
    if (!path) return;
    const timer = setTimeout(() => {
      client.countVideos(inFolder(path)).then(
        (c) => live && setCount(c),
        () => {}
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, exactPath, normalized, noAccess]);

  const suggestions = noAccess
    ? []
    : (cut > 0 ? children : roots).filter(
        (f) =>
          f.name.toLowerCase().startsWith(partial) &&
          f.path.toLowerCase() !== normalized.toLowerCase()
      );

  let status: string;
  let ok: boolean | null;
  if (noAccess) {
    ok = trimmed ? true : null;
    status = trimmed
      ? `Cove matches this path as typed${count == null ? '' : ` · ${fmt(count)} videos`}`
      : 'Type the full path of a folder in the library.';
  } else if (!trimmed) {
    ok = null;
    status = roots.length
      ? `Library folders: ${roots.map((r) => r.path).join(', ')}`
      : 'Type the full path of a folder in the library.';
  } else if (exact) {
    ok = true;
    status = `Folder found${count == null ? '' : ` · ${fmt(count)} videos`}, its subfolders included`;
  } else if (inside(trimmed)) {
    ok = false;
    status = 'Inside a library folder; no folder by that name yet';
  } else {
    ok = false;
    status = 'Not inside a library folder: nothing would match';
  }

  const use = () => {
    if (!ok) return;
    const path = exact?.path ?? normalized;
    onPick({
      chain: folderChain(path, roots),
      subfolders: exact
        ? children.length && parent === normalized
          ? children.length
          : 0
        : 0,
    });
  };

  return (
    <View style={styles.fill}>
      <View style={styles.header}>
        <BackButton onPress={onBack} />
        <Text style={styles.title}>Type a folder path</Text>
      </View>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.typed}
        keyboardShouldPersistTaps="handled"
      >
        {noAccess ? (
          <View style={styles.banner}>
            <Icon name="lock-simple" size={16} color={n.accent300} />
            <Text style={styles.bannerText}>
              This account can’t browse folders (that needs the Files or Library
              scan permission). Type a path inside a library folder; Cove still
              checks it.
            </Text>
          </View>
        ) : null}
        <Text style={styles.section}>Folder path</Text>
        <View style={styles.pathField}>
          <Icon name="folder" size={16} color={n.textAlpha(55)} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={roots[0] ? `${roots[0].path}/…` : '/path/to/folder'}
            placeholderTextColor={n.textAlpha(40)}
            autoCorrect={false}
            autoCapitalize="none"
            autoFocus
            style={styles.pathInput}
          />
          {text ? (
            <Pressable
              onPress={() => setText('')}
              hitSlop={8}
              accessibilityLabel="Clear"
            >
              <Icon name="x-circle" fill size={16} color={n.textAlpha(45)} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.statusRow}>
          <Icon
            name={
              ok
                ? 'check-circle'
                : ok === false
                  ? 'warning-circle'
                  : 'hard-drives'
            }
            fill={!!ok}
            size={14}
            color={ok ? n.accent300 : n.textAlpha(55)}
          />
          <Text style={[styles.status, ok === true && styles.statusOk]}>
            {status}
          </Text>
        </View>
        {suggestions.length ? (
          <Text style={styles.section}>Folders here</Text>
        ) : null}
        {suggestions.map((f) => (
          <Pressable
            key={f.path}
            onPress={() =>
              setText(
                f.path +
                  (f.hasChildren
                    ? f.path.includes('\\') && !f.path.includes('/')
                      ? '\\'
                      : '/'
                    : '')
              )
            }
            style={({ pressed }) => [
              styles.suggestion,
              pressed && styles.suggestionPressed,
            ]}
          >
            <Icon name="folder" size={18} color={n.accent} />
            <Text style={styles.suggestionName} numberOfLines={1}>
              <Text style={styles.suggestionHit}>
                {f.name.slice(0, partial.length)}
              </Text>
              {f.name.slice(partial.length)}
            </Text>
            <Icon
              name="arrow-elbow-down-right"
              size={14}
              color={n.textAlpha(45)}
            />
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.footer}>
        <Button
          label="Use this folder"
          size="lg"
          disabled={!ok}
          onPress={use}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  title: { flex: 1, fontFamily: fonts.medium, fontSize: 17, color: n.text },
  typeLink: {
    height: 44,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  typeText: { fontFamily: fonts.regular, fontSize: 14, color: n.accent300 },
  crumbs: { flexGrow: 0 },
  crumbsContent: { paddingHorizontal: 16, paddingTop: 6, alignItems: 'center' },
  crumbItem: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  crumb: {
    height: 32,
    paddingHorizontal: 8,
    borderRadius: n.radiusMd,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  crumbText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: n.textAlpha(55),
  },
  crumbCurrent: { color: n.accent300 },
  searchWrap: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  search: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: n.radiusMd,
    borderWidth: 1,
    borderColor: n.divider,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: n.text,
    padding: 0,
  },
  list: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 16, gap: 4 },
  section: {
    fontFamily: fonts.medium,
    fontSize: 11,
    letterSpacing: 0.88,
    textTransform: 'uppercase',
    color: n.textAlpha(50),
    marginTop: 4,
    marginBottom: 6,
    marginHorizontal: 4,
  },
  row: {
    minHeight: 64,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: n.radiusMd,
    backgroundColor: n.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowOn: {
    backgroundColor: '#2b2c46', // accent 9% over surface
    borderWidth: 1,
    borderColor: n.accent,
    boxShadow: `0 0 24px ${n.accentAlpha(22)}`,
  },
  tile: {
    width: 40,
    height: 40,
    borderRadius: n.radiusMd,
    backgroundColor: n.accentAlpha(14),
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, minWidth: 0, gap: 3 },
  rowName: { fontFamily: fonts.medium, fontSize: 15, color: n.text },
  rowNameOn: { color: n.accent300 },
  rowMeta: { fontFamily: fonts.regular, fontSize: 12, color: n.textAlpha(55) },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: n.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: n.accent },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: n.accent,
  },
  empty: {
    paddingVertical: 28,
    paddingHorizontal: 12,
    textAlign: 'center',
    fontFamily: fonts.regular,
    fontSize: 13,
    color: n.textAlpha(55),
  },
  footer: {
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'android' ? 16 : 30,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: n.divider,
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 18,
  },
  hint: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 12.5,
    color: n.textAlpha(55),
  },
  typed: { paddingHorizontal: 16, paddingBottom: 16 },
  banner: {
    marginTop: 6,
    marginBottom: 10,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: n.radiusMd,
    backgroundColor: n.textAlpha(5),
  },
  bannerText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 12.5,
    lineHeight: 19,
    color: n.textAlpha(72),
  },
  pathField: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: n.radiusMd,
    borderWidth: 1,
    borderColor: n.accent,
  },
  pathInput: {
    flex: 1,
    fontFamily: fonts.mono,
    fontSize: 14,
    color: n.text,
    padding: 0,
  },
  statusRow: {
    marginTop: 8,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  status: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 12.5,
    color: n.textAlpha(55),
  },
  statusOk: { color: n.accent300 },
  suggestion: {
    minHeight: 48,
    paddingHorizontal: 10,
    borderRadius: n.radiusMd,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  suggestionPressed: { backgroundColor: n.textAlpha(7) },
  suggestionName: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: n.text,
  },
  suggestionHit: { color: n.accent300 },
});
