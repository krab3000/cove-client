import { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { CoveClient } from '../api/cove';
import type { NamedEntity } from '../api/types';
import {
  FIELDS,
  FIELD_SECTIONS,
  PATH_LABELS,
  isFolderMatch,
  MODIFIER_LABELS,
  ORIENTATIONS,
  RESOLUTIONS,
  fieldById,
  needsTwoValues,
  needsValue,
  newCondition,
  validate,
  type Condition,
  type Modifier,
} from '../filter/model';
import { fonts, nocturne as n } from '../theme/tokens';
import { FolderBrowser, TypedPath, type FolderPick } from './FolderBrowser';
import { Icon } from '../ui/Icon';
import { useSafeInsets } from '../platform/insets';
import { Button } from '../ui/Button';
import { ErrorText } from '../ui/Text';

const QUICK_DATES = ['-7d', '-1m', '-1y', '0d'];

/**
 * The editor of one condition, in a bottom sheet: pick a field (new conditions), then its operator and value. Cove's
 * single-condition editor isn't designed yet (the design's open decision 4); this keeps to Nocturne's sheet, chips and
 * outlined primary button.
 */
export function ConditionSheet({
  client,
  condition: initial,
  onSave,
  onCancel,
}: {
  client: CoveClient;
  /** The condition to edit; none: a new one, starting with the field list */
  condition?: Condition;
  onSave: (condition: Condition) => void;
  onCancel: () => void;
}) {
  const insets = useSafeInsets();
  const [condition, setCondition] = useState<Condition | null>(initial ?? null);
  // Path conditions: the folder browser (3b) or the typed path (3d) in place of the editor.
  const [folders, setFolders] = useState<null | 'browse' | 'type' | 'noAccess'>(
    null
  );
  const set = (patch: Partial<Condition>) =>
    setCondition((c) => (c ? { ...c, ...patch } : c));
  const error = condition ? validate(condition) : null;
  const pickFolder = (pick: FolderPick) => {
    const folder = pick.chain[pick.chain.length - 1];
    if (folder) set({ value: folder.path, folder: pick });
    setFolders(null);
  };
  const onType = useCallback(
    (noAccess: boolean) => setFolders(noAccess ? 'noAccess' : 'type'),
    []
  );

  const save = () => {
    if (!condition || error) return;
    const f = fieldById(condition.field);
    const numeric = ['duration', 'rating', 'number'].includes(f.type);
    onSave(
      numeric
        ? {
            ...condition,
            value: Number(condition.value),
            value2:
              condition.value2 === undefined
                ? undefined
                : Number(condition.value2),
          }
        : condition
    );
  };

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View
          style={[
            styles.sheet,
            folders && styles.sheetTall,
            { paddingBottom: insets.bottom },
          ]}
        >
          <View style={styles.grabber} />
          {condition && folders === 'browse' ? (
            <FolderBrowser
              client={client}
              start={condition.folder?.chain ?? []}
              onPick={pickFolder}
              onBack={() => setFolders(null)}
              onType={onType}
            />
          ) : condition && folders ? (
            <TypedPath
              client={client}
              noAccess={folders === 'noAccess'}
              initial={String(condition.value ?? '')}
              onPick={pickFolder}
              onBack={() =>
                setFolders(folders === 'noAccess' ? null : 'browse')
              }
            />
          ) : condition && fieldById(condition.field).type === 'path' ? (
            <PathEditor
              client={client}
              condition={condition}
              set={set}
              onBrowse={() => setFolders('browse')}
              onChangeField={initial ? undefined : () => setCondition(null)}
            />
          ) : condition ? (
            <Editor
              client={client}
              condition={condition}
              set={set}
              onChangeField={initial ? undefined : () => setCondition(null)}
            />
          ) : (
            <FieldList onPick={(id) => setCondition(newCondition(id))} />
          )}
          {condition && !folders ? (
            <View style={styles.footer}>
              {error ? <ErrorText>{error}</ErrorText> : null}
              <Button
                label={initial ? 'Save condition' : 'Add condition'}
                size="lg"
                onPress={save}
                // Still pressable: pressing says what is missing
                style={error ? styles.dimmed : undefined}
              />
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function FieldList({ onPick }: { onPick: (fieldId: string) => void }) {
  return (
    <>
      <Text style={styles.sheetTitle}>Add a condition</Text>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {FIELD_SECTIONS.map((section) => (
          <View key={section}>
            <Text style={styles.section}>{section}</Text>
            {FIELDS.filter((f) => f.section === section).map((f) => (
              <Pressable
                key={f.id}
                onPress={() => onPick(f.id)}
                style={({ pressed }) => [
                  styles.fieldRow,
                  pressed && styles.fieldRowPressed,
                ]}
              >
                <Text style={styles.fieldText}>{f.label}</Text>
                <Icon name="caret-right" size={14} color={n.textAlpha(45)} />
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </>
  );
}

function Editor({
  client,
  condition,
  set,
  onChangeField,
}: {
  client: CoveClient;
  condition: Condition;
  set: (patch: Partial<Condition>) => void;
  onChangeField?: () => void;
}) {
  const f = fieldById(condition.field);
  const operatorLabel = (m: Modifier) =>
    m === 'equals' && f.type === 'bool' ? 'is' : MODIFIER_LABELS[m];
  return (
    <>
      <View style={styles.editorHeader}>
        {onChangeField ? (
          <Pressable
            onPress={onChangeField}
            hitSlop={8}
            style={styles.backButton}
          >
            <Icon name="caret-left" size={18} color={n.text} />
          </Pressable>
        ) : null}
        <Text style={styles.sheetTitle}>{f.label}</Text>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {f.modifiers.length > 1 ? (
          <>
            <Text style={styles.section}>Operator</Text>
            <View style={styles.chips}>
              {f.modifiers.map((m) => (
                <Chip
                  key={m}
                  label={operatorLabel(m)}
                  on={condition.modifier === m}
                  onPress={() => set({ modifier: m })}
                />
              ))}
            </View>
          </>
        ) : null}
        {needsValue(condition.modifier) ? (
          <>
            <Text style={styles.section}>Value</Text>
            <ValueEditor client={client} condition={condition} set={set} />
          </>
        ) : null}
      </ScrollView>
    </>
  );
}

/**
 * Design 3a: a path condition. "In folder" / "Not in folder" pick a library folder (the folder and everything inside
 * it); "Contains text" and "Regex" match the path as text.
 */
function PathEditor({
  client,
  condition,
  set,
  onBrowse,
  onChangeField,
}: {
  client: CoveClient;
  condition: Condition;
  set: (patch: Partial<Condition>) => void;
  onBrowse: () => void;
  onChangeField?: () => void;
}) {
  const f = fieldById(condition.field);
  const folderMatch = isFolderMatch(condition.modifier);
  const chain = condition.folder?.chain ?? [];
  const names = (chain.length > 1 ? chain.slice(1) : chain).map((x) => x.name);
  const valid = validate(condition) === null;
  const [count, setCount] = useState<number | null>(null);
  const value = String(condition.value ?? '');
  useEffect(() => {
    let live = true;
    setCount(null);
    if (!valid) return;
    const timer = setTimeout(() => {
      client
        .countVideos({
          operator: 'AND',
          children: [
            {
              filter: {
                pathCriterion: { value, modifier: condition.modifier },
              },
            },
          ],
        })
        .then(
          (c) => live && setCount(c),
          () => {}
        );
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, value, condition.modifier, valid]);

  const subfolders = condition.folder?.subfolders ?? 0;
  const last = names[names.length - 1];
  return (
    <>
      <View style={styles.editorHeader}>
        {onChangeField ? (
          <Pressable
            onPress={onChangeField}
            hitSlop={8}
            style={styles.backButton}
          >
            <Icon name="caret-left" size={18} color={n.text} />
          </Pressable>
        ) : null}
        <Text style={styles.sheetTitle}>{f.label}</Text>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.section}>Match</Text>
        <View style={styles.chips}>
          {f.modifiers.map((m) => {
            const on = condition.modifier === m;
            return (
              <Pressable
                key={m}
                onPress={() => {
                  // Between folder and text matches the value means something else: start over.
                  const keep = isFolderMatch(m) === folderMatch;
                  set(
                    keep
                      ? { modifier: m }
                      : { modifier: m, value: '', folder: undefined }
                  );
                }}
                style={[styles.chip, styles.chipTall, on && styles.chipOn]}
              >
                {m === 'underPath' ? (
                  <Icon
                    name="folder"
                    size={14}
                    color={on ? n.accent100 : n.text}
                  />
                ) : null}
                <Text style={[styles.chipText, on && styles.chipTextOn]}>
                  {PATH_LABELS[m]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {folderMatch ? (
          <>
            <Text style={[styles.section, styles.sectionGap]}>Folder</Text>
            <Pressable
              onPress={onBrowse}
              style={[styles.folderCard, value ? styles.folderCardOn : null]}
            >
              <View style={styles.folderTile}>
                <Icon name="folder" fill={!!value} size={20} color={n.accent} />
              </View>
              <View style={styles.folderBody}>
                {value ? (
                  <>
                    <View style={styles.crumbLine}>
                      {names.map((name, i) => (
                        <View key={i} style={styles.crumbPart}>
                          {i ? (
                            <Icon
                              name="caret-right"
                              size={11}
                              color={n.textAlpha(45)}
                            />
                          ) : null}
                          <Text style={styles.folderName} numberOfLines={1}>
                            {name}
                          </Text>
                        </View>
                      ))}
                    </View>
                    <Text
                      style={styles.folderPath}
                      numberOfLines={1}
                      ellipsizeMode="head"
                    >
                      {value}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.folderName}>Choose a folder</Text>
                )}
              </View>
              <Text style={styles.change}>{value ? 'Change' : 'Browse'}</Text>
            </Pressable>
            {value ? (
              <View style={styles.inside}>
                <Icon name="tree-structure" size={15} color={n.textAlpha(45)} />
                <Text style={styles.insideText}>
                  {subfolders
                    ? `Includes everything inside it: ${last} and its ${subfolders} subfolder${subfolders === 1 ? '' : 's'}.`
                    : `Includes everything inside ${last ?? 'it'}.`}
                </Text>
              </View>
            ) : null}
          </>
        ) : (
          <>
            <Text style={[styles.section, styles.sectionGap]}>
              {condition.modifier === 'matchesRegex' ? 'Pattern' : 'Text'}
            </Text>
            <Field
              value={value}
              onChange={(t) => set({ value: t })}
              mono
              placeholder={
                condition.modifier === 'matchesRegex'
                  ? 'A regular expression'
                  : 'Part of the file path'
              }
            />
          </>
        )}
        {valid ? (
          <>
            <View style={styles.rule} />
            <View style={styles.countRow}>
              <Text style={styles.countLabel}>With this condition</Text>
              <Text style={styles.countValue}>
                {count == null
                  ? '…'
                  : `${count.toLocaleString('en-US')} videos`}
              </Text>
            </View>
          </>
        ) : null}
      </ScrollView>
    </>
  );
}

function ValueEditor({
  client,
  condition,
  set,
}: {
  client: CoveClient;
  condition: Condition;
  set: (patch: Partial<Condition>) => void;
}) {
  const f = fieldById(condition.field);
  const two = needsTwoValues(condition.modifier);
  switch (f.type) {
    case 'multiId':
      return <EntityPicker client={client} condition={condition} set={set} />;
    case 'resolution':
      return (
        <View style={styles.chips}>
          {RESOLUTIONS.map((r) => (
            <Chip
              key={r.value}
              label={r.label}
              on={condition.value === r.value}
              onPress={() => set({ value: r.value })}
            />
          ))}
        </View>
      );
    case 'orientation':
      return (
        <View style={styles.chips}>
          {ORIENTATIONS.map((o) => (
            <Chip
              key={o.value}
              label={o.label}
              on={condition.value === o.value}
              onPress={() => set({ value: o.value })}
            />
          ))}
        </View>
      );
    case 'bool':
      return (
        <View style={styles.chips}>
          <Chip
            label="Yes"
            on={condition.value === true}
            onPress={() => set({ value: true })}
          />
          <Chip
            label="No"
            on={condition.value === false}
            onPress={() => set({ value: false })}
          />
        </View>
      );
    case 'rating': {
      const stars = (which: 'value' | 'value2') => (
        <View style={styles.chips}>
          {[1, 2, 3, 4, 5].map((s) => (
            <Chip
              key={s}
              label={`${s}★`}
              on={Number(condition[which]) === s}
              onPress={() => set({ [which]: s })}
            />
          ))}
        </View>
      );
      return (
        <View style={styles.values}>
          {stars('value')}
          {two ? (
            <>
              <Text style={styles.and}>and</Text>
              {stars('value2')}
            </>
          ) : null}
        </View>
      );
    }
    case 'date':
    case 'timestamp':
      return <DateValues condition={condition} set={set} two={two} />;
    case 'duration':
    case 'number': {
      const unit = f.type === 'duration' ? 'min' : undefined;
      return (
        <View style={styles.values}>
          <Field
            value={String(condition.value ?? '')}
            onChange={(t) => set({ value: t })}
            numeric
            unit={unit}
          />
          {two ? (
            <>
              <Text style={styles.and}>and</Text>
              <Field
                value={String(condition.value2 ?? '')}
                onChange={(t) => set({ value2: t })}
                numeric
                unit={unit}
              />
            </>
          ) : null}
        </View>
      );
    }
    default:
      return (
        <Field
          value={String(condition.value ?? '')}
          onChange={(t) => set({ value: t })}
          placeholder={
            condition.modifier === 'matchesRegex' ||
            condition.modifier === 'notMatchesRegex'
              ? 'A regular expression'
              : 'Text'
          }
        />
      );
  }
}

function DateValues({
  condition,
  set,
  two,
}: {
  condition: Condition;
  set: (patch: Partial<Condition>) => void;
  two: boolean;
}) {
  const [active, setActive] = useState<'value' | 'value2'>('value');
  return (
    <View style={styles.values}>
      <Field
        value={String(condition.value ?? '')}
        onChange={(t) => set({ value: t })}
        onFocus={() => setActive('value')}
        mono
        placeholder="-1y or 2025-10-04"
      />
      {two ? (
        <>
          <Text style={styles.and}>and</Text>
          <Field
            value={String(condition.value2 ?? '')}
            onChange={(t) => set({ value2: t })}
            onFocus={() => setActive('value2')}
            mono
            placeholder="0d or 2025-10-04"
          />
        </>
      ) : null}
      <View style={styles.chips}>
        {QUICK_DATES.map((d) => (
          <Chip
            key={d}
            label={d}
            mono
            on={condition[active] === d}
            onPress={() => set({ [active]: d })}
          />
        ))}
      </View>
      <Text style={styles.hint}>
        Relative dates count from now: -7d is a week ago, -1y3m a year and three
        months ago, 0d today.
      </Text>
    </View>
  );
}

function EntityPicker({
  client,
  condition,
  set,
}: {
  client: CoveClient;
  condition: Condition;
  set: (patch: Partial<Condition>) => void;
}) {
  const f = fieldById(condition.field);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<NamedEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const selected = Array.isArray(condition.value) ? condition.value : [];
  const names = condition.names ?? {};

  useEffect(() => {
    let current = true;
    setLoading(true);
    const timer = setTimeout(() => {
      client.lookup(f.lookup!, q).then(
        (items) => {
          if (!current) return;
          setResults(items);
          setLoading(false);
        },
        () => current && setLoading(false)
      );
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [client, f.lookup, q]);

  const toggle = (item: NamedEntity) => {
    const on = selected.includes(item.id);
    set({
      value: on
        ? selected.filter((id) => id !== item.id)
        : [...selected, item.id],
      names: { ...names, [item.id]: item.name },
    });
  };

  return (
    <View style={styles.values}>
      {selected.length ? (
        <View style={styles.chips}>
          {selected.map((id) => (
            <Pressable
              key={id}
              onPress={() => toggle({ id, name: names[id] ?? `#${id}` })}
              style={[styles.chip, styles.chipOn]}
            >
              <Text style={[styles.chipText, styles.chipTextOn]}>
                {names[id] ?? `#${id}`}
              </Text>
              <Icon name="x" size={12} color={n.accent100} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.search}>
        <Icon name="magnifying-glass" size={16} color={n.textAlpha(55)} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={`Search ${f.label.toLowerCase()}s`}
          placeholderTextColor={n.textAlpha(40)}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>
      {loading && !results.length ? (
        <Text style={styles.hint}>Searching…</Text>
      ) : null}
      {!loading && !results.length ? (
        <Text style={styles.hint}>Nothing found.</Text>
      ) : null}
      {results.map((item) => {
        const on = selected.includes(item.id);
        return (
          <Pressable
            key={item.id}
            onPress={() => toggle(item)}
            style={({ pressed }) => [
              styles.fieldRow,
              pressed && styles.fieldRowPressed,
            ]}
          >
            <Text
              style={[styles.fieldText, on && styles.fieldTextOn]}
              numberOfLines={1}
            >
              {item.name}
            </Text>
            {on ? <Icon name="check" size={16} color={n.accent} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function Field({
  value,
  onChange,
  onFocus,
  numeric,
  mono,
  unit,
  placeholder,
}: {
  value: string;
  onChange: (text: string) => void;
  onFocus?: () => void;
  numeric?: boolean;
  mono?: boolean;
  unit?: string;
  placeholder?: string;
}) {
  return (
    <View style={styles.input}>
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={onFocus}
        keyboardType={numeric ? 'numeric' : 'default'}
        placeholder={placeholder}
        placeholderTextColor={n.textAlpha(40)}
        autoCorrect={false}
        autoCapitalize="none"
        style={[styles.inputText, mono && styles.mono]}
      />
      {unit ? <Text style={styles.unit}>{unit}</Text> : null}
    </View>
  );
}

function Chip({
  label,
  on,
  mono,
  onPress,
}: {
  label: string;
  on: boolean;
  mono?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text
        style={[styles.chipText, on && styles.chipTextOn, mono && styles.mono]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dimmed: { opacity: 0.45 },
  scrim: { flex: 1, backgroundColor: n.scrim, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '86%',
    backgroundColor: n.surface,
    borderTopLeftRadius: n.radiusSheet,
    borderTopRightRadius: n.radiusSheet,
  },
  sheetTall: { height: '92%', maxHeight: '92%' },
  chipTall: { height: 34 },
  sectionGap: { marginTop: 18 },
  folderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: n.radiusMd,
    borderWidth: 1,
    borderColor: n.divider,
  },
  folderCardOn: {
    backgroundColor: '#2b2c46', // accent 9% over surface
    borderColor: n.accent,
    boxShadow: `0 0 24px ${n.accentAlpha(22)}`,
  },
  folderTile: {
    width: 40,
    height: 40,
    borderRadius: n.radiusMd,
    backgroundColor: n.accentAlpha(14),
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderBody: { flex: 1, minWidth: 0, gap: 3 },
  crumbLine: { flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  crumbPart: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginRight: 4,
    flexShrink: 1,
  },
  folderName: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: n.text,
    flexShrink: 1,
  },
  folderPath: { fontFamily: fonts.mono, fontSize: 12, color: n.accent300 },
  change: { fontFamily: fonts.regular, fontSize: 13, color: n.accent300 },
  inside: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  insideText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 12.5,
    lineHeight: 19,
    color: n.textAlpha(55),
  },
  rule: {
    marginTop: 14,
    height: 1,
    experimental_backgroundImage: `linear-gradient(to right, transparent 0%, ${n.divider} 14%, ${n.divider} 86%, transparent 100%)`,
  },
  countRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  countLabel: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: n.textAlpha(55),
  },
  countValue: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: n.text,
    fontVariant: ['tabular-nums'],
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: n.neutral700,
    marginTop: 10,
    marginBottom: 6,
  },
  editorHeader: { flexDirection: 'row', alignItems: 'center', paddingLeft: 8 },
  backButton: {
    width: 36,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: {
    fontFamily: fonts.medium,
    fontSize: 17,
    color: n.text,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 16 },
  section: {
    fontFamily: fonts.medium,
    fontSize: 11,
    letterSpacing: 0.88,
    textTransform: 'uppercase',
    color: n.textAlpha(50),
    marginTop: 12,
    marginBottom: 8,
  },
  fieldRow: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderRadius: n.radiusMd,
  },
  fieldRowPressed: { backgroundColor: n.textAlpha(7) },
  fieldText: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: n.text,
    flexShrink: 1,
  },
  fieldTextOn: { color: n.accent300 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: n.divider,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipOn: { backgroundColor: n.accent800, borderColor: n.accent800 },
  chipText: { fontFamily: fonts.regular, fontSize: 13, color: n.text },
  chipTextOn: { color: n.accent100 },
  values: { gap: 10 },
  and: { fontFamily: fonts.regular, fontSize: 13, color: n.accent300 },
  input: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderRadius: n.radiusMd,
    borderWidth: 1,
    borderColor: n.accent,
  },
  inputText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: n.text,
    padding: 0,
  },
  mono: { fontFamily: fonts.mono },
  unit: { fontFamily: fonts.regular, fontSize: 13, color: n.textAlpha(55) },
  search: {
    height: 44,
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
  hint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: n.textAlpha(55),
    lineHeight: 17,
  },
  footer: {
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: n.divider,
  },
});
