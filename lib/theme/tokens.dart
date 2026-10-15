// Nocturne, the design system of the Cove Mobile design (design/tokens/nocturne.css, design/tokens/nocturne-guide.md):
// the app's tokens.

import 'package:flutter/painting.dart';

const _text = Color(0xFFE9E9ED);
const _accent = Color(0xFF9184D9);

abstract final class Nocturne {
  static const bg = Color(0xFF161826);
  static const surface = Color(0xFF232532);
  // Surface 55% over the ground: the tablet sidebar, the sign-in list
  static const sidebar = Color(0xFF1D1F2C);
  static const text = _text;
  static const accent = _accent;
  static const accent100 = Color(0xFFF5F4FF);
  static const accent200 = Color(0xFFE7E5FE);
  static const accent300 = Color(0xFFD2CEFD);
  static const accent800 = Color(0xFF423A6A);
  static const accent900 = Color(0xFF2B2741);
  static const neutral700 = Color(0xFF595D6C);
  static const neutral800 = Color(0xFF3F424D);
  // One red for every error
  static const danger = Color(0xFFFF8A8A);
  static final divider = textAlpha(16);

  /// color-mix(text N%, transparent)
  static Color textAlpha(num percent) => _text.withValues(alpha: percent / 100);

  /// color-mix(accent N%, transparent)
  static Color accentAlpha(num percent) =>
      _accent.withValues(alpha: percent / 100);

  static const radiusMd = 8.0;
  static const radiusLg = 14.0;
  static const radiusPopover = 16.0;
  static const radiusSheet = 22.0;
}

/// Inter at a size and weight (the app's one family: 400, 500, 600).
TextStyle inter(
  double size, {
  FontWeight weight = FontWeight.w400,
  Color color = Nocturne.text,
  double? height,
  double? letterSpacing,
}) => TextStyle(
  fontFamily: 'Inter',
  fontSize: size,
  fontWeight: weight,
  color: color,
  height: height == null ? null : height / size,
  letterSpacing: letterSpacing,
);

const medium = FontWeight.w500;

/// A raised panel's shadow (a drawer, a popover): ambient darkness on the dark ground.
const raisedShadow = [
  BoxShadow(color: Color(0x80000000), offset: Offset(-12, 0), blurRadius: 48),
  BoxShadow(color: Color(0x66000000), offset: Offset(0, 24), blurRadius: 60),
];

/// The monospace face (paths, relative dates): the platform's own.
TextStyle mono(double size, {Color color = Nocturne.text}) => TextStyle(
  fontFamily: 'Menlo',
  fontFamilyFallback: const ['monospace', 'Courier New'],
  fontSize: size,
  color: color,
);

abstract final class NocturneExtra {
  // Text 6% over the surface: a row on a surface (the filter drawer's rows)
  static const raised = Color(0xFF2F313D);
  static const neutral300 = Color(0xFFCFD3E5);
}
