import type { LibraryView } from './components/LibraryHeader';

// The three views of the Library (design 1f/1g). A phone gets the grids' named number of columns; a wider window
// fits more, none narrower than `target`. The list is a feed: one card in a row, at most LIST_MAX_WIDTH wide (wider,
// a card would be taller than the screen), centred.
const VIEWS: Record<
  LibraryView,
  { min: number; target: number; padX: number; gapX: number; gapY: number }
> = {
  grid2: { min: 2, target: 300, padX: 16, gapX: 12, gapY: 16 },
  grid3: { min: 3, target: 190, padX: 16, gapX: 8, gapY: 12 },
  list: { min: 1, target: 520, padX: 20, gapX: 20, gapY: 28 },
};
const LIST_MAX_WIDTH = 960;

/** A tile's text block under its thumbnail: the title, and the studio in 2 columns (fixed: rows have a fixed height). */
export function tileTextHeight(showStudio: boolean): number {
  return 5 + 16 + (showStudio ? 1 + 15 : 0);
}

/** The list card's height for a width: the 16:9 thumbnail, the title block and the chip row (all fixed). */
export function listCardHeight(width: number): number {
  return Math.round((width * 9) / 16) + 10 + 44 + 10 + 28;
}

/**
 * The grid's geometry for a width and a view: how many columns, each card's size, the rows' height (fixed, so the
 * list can be virtual and jump anywhere) and the space left of the first column.
 */
export function useGridLayout(width: number, view: LibraryView) {
  const spec = VIEWS[view];
  const list = view === 'list';
  const columns = list
    ? 1
    : Math.max(
        spec.min,
        Math.floor(
          (width - 2 * spec.padX + spec.gapX) / (spec.target + spec.gapX)
        )
      );
  const cardWidth = list
    ? Math.min(LIST_MAX_WIDTH, Math.floor(width - 2 * spec.padX))
    : Math.floor((width - 2 * spec.padX - spec.gapX * (columns - 1)) / columns);
  const padX = list ? Math.floor((width - cardWidth) / 2) : spec.padX;
  const cardHeight =
    view === 'list'
      ? listCardHeight(cardWidth)
      : Math.round((cardWidth * 9) / 16) + tileTextHeight(view === 'grid2');
  return {
    spec,
    columns,
    cardWidth,
    cardHeight,
    rowHeight: cardHeight + spec.gapY,
    padX,
  };
}
