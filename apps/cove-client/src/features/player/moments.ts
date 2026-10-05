import type { Segment } from '../../api/types';

/** The name a segment (the design's moment) goes by: its title, else its tag, else its kind. */
export function segmentLabel(s: Segment): string {
  return s.title?.trim() || s.tagName || s.kind || 'Moment';
}
