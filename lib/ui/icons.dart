import 'package:flutter/widgets.dart';

/// Phosphor icons (https://phosphoricons.com), from its icon fonts in assets/fonts: the
/// glyphs the app uses, with their codepoints from @phosphor-icons/web's style.css. The fill
/// font has the same codepoints: [Phosphor.fill] gives an icon's filled glyph (active states, play).
abstract final class Phosphor {
  static const arrowClockwise = IconData(0xe036, fontFamily: _regular);
  static const arrowCounterClockwise = IconData(0xe038, fontFamily: _regular);
  static const arrowElbowDownRight = IconData(0xe046, fontFamily: _regular);
  static const arrowElbowUpLeft = IconData(0xe054, fontFamily: _regular);
  static const arrowLineDown = IconData(0xe05c, fontFamily: _regular);
  static const arrowLineUp = IconData(0xe066, fontFamily: _regular);
  static const arrowSquareIn = IconData(0xe5dc, fontFamily: _regular);
  static const arrowsClockwise = IconData(0xe094, fontFamily: _regular);
  static const bookmarkSimple = IconData(0xe0ea, fontFamily: _regular);
  static const bookmarksSimple = IconData(0xe5f0, fontFamily: _regular);
  static const bracketsCurly = IconData(0xe860, fontFamily: _regular);
  static const caretDown = IconData(0xe136, fontFamily: _regular);
  static const caretLeft = IconData(0xe138, fontFamily: _regular);
  static const caretRight = IconData(0xe13a, fontFamily: _regular);
  static const caretUpDown = IconData(0xe140, fontFamily: _regular);
  static const check = IconData(0xe182, fontFamily: _regular);
  static const checkCircle = IconData(0xe184, fontFamily: _regular);
  static const clipboardText = IconData(0xe198, fontFamily: _regular);
  static const clockClockwise = IconData(0xe19e, fontFamily: _regular);
  static const clockCounterClockwise = IconData(0xe1a0, fontFamily: _regular);
  static const closedCaptioning = IconData(0xe1a4, fontFamily: _regular);
  static const cloudArrowDown = IconData(0xe1ac, fontFamily: _regular);
  static const copy = IconData(0xe1ca, fontFamily: _regular);
  static const cornersIn = IconData(0xe1ce, fontFamily: _regular);
  static const cornersOut = IconData(0xe1d0, fontFamily: _regular);
  static const cursorText = IconData(0xe7d8, fontFamily: _regular);
  static const dotsNine = IconData(0xe1fc, fontFamily: _regular);
  static const dotsThreeVertical = IconData(0xe208, fontFamily: _regular);
  static const eraser = IconData(0xe21e, fontFamily: _regular);
  static const eyeSlash = IconData(0xe224, fontFamily: _regular);
  static const filmStrip = IconData(0xe792, fontFamily: _regular);
  static const folder = IconData(0xe24a, fontFamily: _regular);
  static const funnelSimple = IconData(0xe268, fontFamily: _regular);
  static const gauge = IconData(0xe628, fontFamily: _regular);
  static const gearSix = IconData(0xe272, fontFamily: _regular);
  static const hardDrives = IconData(0xe2a0, fontFamily: _regular);
  static const heart = IconData(0xe2a8, fontFamily: _regular);
  static const info = IconData(0xe2ce, fontFamily: _regular);
  static const listBullets = IconData(0xe2f2, fontFamily: _regular);
  static const lockSimple = IconData(0xe308, fontFamily: _regular);
  static const lockSimpleOpen = IconData(0xe30a, fontFamily: _regular);
  static const magicWand = IconData(0xe6b6, fontFamily: _regular);
  static const magnifyingGlass = IconData(0xe30c, fontFamily: _regular);
  static const minus = IconData(0xe32a, fontFamily: _regular);
  static const pause = IconData(0xe39e, fontFamily: _regular);
  static const pencilSimple = IconData(0xe3b4, fontFamily: _regular);
  static const play = IconData(0xe3d0, fontFamily: _regular);
  static const playCircle = IconData(0xe3d2, fontFamily: _regular);
  static const plugs = IconData(0xeb56, fontFamily: _regular);
  static const plus = IconData(0xe3d4, fontFamily: _regular);
  static const pulse = IconData(0xe000, fontFamily: _regular);
  static const rows = IconData(0xe5a2, fontFamily: _regular);
  static const scissors = IconData(0xeae0, fontFamily: _regular);
  static const shuffle = IconData(0xe422, fontFamily: _regular);
  static const signOut = IconData(0xe42a, fontFamily: _regular);
  static const skipForward = IconData(0xe5a6, fontFamily: _regular);
  static const sortDescending = IconData(0xe446, fontFamily: _regular);
  static const speakerHigh = IconData(0xe44a, fontFamily: _regular);
  static const speakerSlash = IconData(0xe45a, fontFamily: _regular);
  static const squaresFour = IconData(0xe464, fontFamily: _regular);
  static const stack = IconData(0xe466, fontFamily: _regular);
  static const star = IconData(0xe46a, fontFamily: _regular);
  static const trash = IconData(0xe4a6, fontFamily: _regular);
  static const treeStructure = IconData(0xe67c, fontFamily: _regular);
  static const user = IconData(0xe4c2, fontFamily: _regular);
  static const warningCircle = IconData(0xe4e2, fontFamily: _regular);
  static const waveform = IconData(0xe802, fontFamily: _regular);
  static const x = IconData(0xe4f6, fontFamily: _regular);
  static const xCircle = IconData(0xe4f8, fontFamily: _regular);

  /// The icon's filled glyph.
  static IconData fill(IconData icon) => _fills[icon.codePoint]!;

  // Constant, so the fonts can be tree-shaken: IconData can't be made from a codepoint at run time
  static const _fills = {
    0xe000: IconData(0xe000, fontFamily: _fill),
    0xe036: IconData(0xe036, fontFamily: _fill),
    0xe038: IconData(0xe038, fontFamily: _fill),
    0xe046: IconData(0xe046, fontFamily: _fill),
    0xe054: IconData(0xe054, fontFamily: _fill),
    0xe05c: IconData(0xe05c, fontFamily: _fill),
    0xe066: IconData(0xe066, fontFamily: _fill),
    0xe094: IconData(0xe094, fontFamily: _fill),
    0xe0ea: IconData(0xe0ea, fontFamily: _fill),
    0xe136: IconData(0xe136, fontFamily: _fill),
    0xe138: IconData(0xe138, fontFamily: _fill),
    0xe13a: IconData(0xe13a, fontFamily: _fill),
    0xe140: IconData(0xe140, fontFamily: _fill),
    0xe182: IconData(0xe182, fontFamily: _fill),
    0xe184: IconData(0xe184, fontFamily: _fill),
    0xe198: IconData(0xe198, fontFamily: _fill),
    0xe19e: IconData(0xe19e, fontFamily: _fill),
    0xe1a0: IconData(0xe1a0, fontFamily: _fill),
    0xe1a4: IconData(0xe1a4, fontFamily: _fill),
    0xe1ac: IconData(0xe1ac, fontFamily: _fill),
    0xe1ca: IconData(0xe1ca, fontFamily: _fill),
    0xe1ce: IconData(0xe1ce, fontFamily: _fill),
    0xe1d0: IconData(0xe1d0, fontFamily: _fill),
    0xe1fc: IconData(0xe1fc, fontFamily: _fill),
    0xe208: IconData(0xe208, fontFamily: _fill),
    0xe21e: IconData(0xe21e, fontFamily: _fill),
    0xe224: IconData(0xe224, fontFamily: _fill),
    0xe24a: IconData(0xe24a, fontFamily: _fill),
    0xe268: IconData(0xe268, fontFamily: _fill),
    0xe272: IconData(0xe272, fontFamily: _fill),
    0xe2a0: IconData(0xe2a0, fontFamily: _fill),
    0xe2a8: IconData(0xe2a8, fontFamily: _fill),
    0xe2ce: IconData(0xe2ce, fontFamily: _fill),
    0xe2f2: IconData(0xe2f2, fontFamily: _fill),
    0xe308: IconData(0xe308, fontFamily: _fill),
    0xe30a: IconData(0xe30a, fontFamily: _fill),
    0xe30c: IconData(0xe30c, fontFamily: _fill),
    0xe32a: IconData(0xe32a, fontFamily: _fill),
    0xe39e: IconData(0xe39e, fontFamily: _fill),
    0xe3b4: IconData(0xe3b4, fontFamily: _fill),
    0xe3d0: IconData(0xe3d0, fontFamily: _fill),
    0xe3d2: IconData(0xe3d2, fontFamily: _fill),
    0xe3d4: IconData(0xe3d4, fontFamily: _fill),
    0xe422: IconData(0xe422, fontFamily: _fill),
    0xe42a: IconData(0xe42a, fontFamily: _fill),
    0xe446: IconData(0xe446, fontFamily: _fill),
    0xe44a: IconData(0xe44a, fontFamily: _fill),
    0xe45a: IconData(0xe45a, fontFamily: _fill),
    0xe464: IconData(0xe464, fontFamily: _fill),
    0xe466: IconData(0xe466, fontFamily: _fill),
    0xe46a: IconData(0xe46a, fontFamily: _fill),
    0xe4a6: IconData(0xe4a6, fontFamily: _fill),
    0xe4c2: IconData(0xe4c2, fontFamily: _fill),
    0xe4e2: IconData(0xe4e2, fontFamily: _fill),
    0xe4f6: IconData(0xe4f6, fontFamily: _fill),
    0xe4f8: IconData(0xe4f8, fontFamily: _fill),
    0xe5a2: IconData(0xe5a2, fontFamily: _fill),
    0xe5a6: IconData(0xe5a6, fontFamily: _fill),
    0xe5dc: IconData(0xe5dc, fontFamily: _fill),
    0xe5f0: IconData(0xe5f0, fontFamily: _fill),
    0xe628: IconData(0xe628, fontFamily: _fill),
    0xe67c: IconData(0xe67c, fontFamily: _fill),
    0xe6b6: IconData(0xe6b6, fontFamily: _fill),
    0xe792: IconData(0xe792, fontFamily: _fill),
    0xe7d8: IconData(0xe7d8, fontFamily: _fill),
    0xe802: IconData(0xe802, fontFamily: _fill),
    0xe860: IconData(0xe860, fontFamily: _fill),
    0xeae0: IconData(0xeae0, fontFamily: _fill),
    0xeb56: IconData(0xeb56, fontFamily: _fill),
  };

  static const _regular = 'Phosphor';
  static const _fill = 'Phosphor-Fill';
}
