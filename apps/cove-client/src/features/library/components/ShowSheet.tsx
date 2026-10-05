import type { SavedFilter } from '../../../api/types';
import { formatCount } from '../../../lib/format';
import type { IconName } from '../../../ui/Icon';
import {
  Sheet,
  SheetHeading,
  SheetRow,
  SheetRule,
  SheetSection,
} from '../../../ui/Sheet';
import { loadSavedFilter } from '../../filter/saved';

const videos = (num: number | undefined) =>
  num == null ? '…' : `${formatCount(num)} videos`;

/**
 * The title's Show sheet (design 6d): all videos, the saved filters with their counts and the view they open in,
 * the quick filters, and Save as new filter while there is a filter or a search.
 */
export function ShowSheet({
  visible,
  onClose,
  counts,
  allChecked,
  onAll,
  savedFilters,
  savedId,
  onSaved,
  quick,
  canSaveNew,
  onSaveNew,
}: {
  visible: boolean;
  onClose: () => void;
  // By 'all' and 'saved-<id>'
  counts: Record<string, number | undefined>;
  allChecked: boolean;
  onAll: () => void;
  savedFilters: SavedFilter[];
  // The saved filter shown, if any
  savedId: number | null;
  onSaved: (filter: SavedFilter) => void;
  quick: {
    key: string;
    label: string;
    icon: IconName;
    checked: boolean;
    onPress: () => void;
  }[];
  canSaveNew: boolean;
  onSaveNew: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetHeading>Show</SheetHeading>
      <SheetRow
        icon="film-strip"
        label="All videos"
        meta={videos(counts.all)}
        checked={allChecked}
        onPress={onAll}
      />
      {savedFilters.length ? <SheetSection>Saved filters</SheetSection> : null}
      {savedFilters.map((f) => {
        const opens = loadSavedFilter(f).view;
        return (
          <SheetRow
            key={f.id}
            icon="bookmarks-simple"
            label={f.name}
            meta={[
              videos(counts[`saved-${f.id}`]),
              opens ? `opens in ${opens}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            checked={savedId === f.id}
            onPress={() => {
              onClose();
              onSaved(f);
            }}
          />
        );
      })}
      <SheetSection>Quick</SheetSection>
      {quick.map((q) => (
        <SheetRow
          key={q.key}
          icon={q.icon}
          label={q.label}
          checked={q.checked}
          onPress={q.onPress}
        />
      ))}
      {canSaveNew ? (
        <>
          <SheetRule />
          <SheetRow
            icon="plus"
            label="Save as new filter…"
            meta="The filter, search and view"
            accent
            onPress={onSaveNew}
          />
        </>
      ) : null}
    </Sheet>
  );
}
