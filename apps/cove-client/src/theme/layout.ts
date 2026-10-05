// Screen classes, one definition for the whole app.

/** A large screen (tablet, desktop): the shorter side of the window at least this many dp. */
export const LARGE = 600;

export function isLarge(width: number, height: number): boolean {
  return Math.min(width, height) >= LARGE;
}
