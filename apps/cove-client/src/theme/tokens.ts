// Nocturne, the design system of the Cove Mobile design (design_handoff_cove_mobile/design/tokens/nocturne.css): the
// app's tokens. Fonts are in android/app/src/main/assets/fonts (Android: fontFamily = file name), shared with Windows.

import { Platform } from 'react-native';

const text = '233,233,237'; // #e9e9ed
const accent = '145,132,217'; // #9184d9

export const nocturne = {
  bg: '#161826',
  surface: '#232532',
  // Surface 55% over the ground: the tablet sidebar, the sign-in list, the player's side panel
  sidebar: '#1d1f2c',
  // Text 6% over the surface: a row on a surface (the filter drawer's rows)
  raised: '#2f313d',
  // Accent 9% over the surface: a chosen row
  selected: '#2b2c46',
  text: '#e9e9ed',
  accent: '#9184d9',
  accent100: '#f5f4ff',
  accent200: '#e7e5fe',
  accent300: '#d2cefd',
  accent400: '#b5abfc',
  accent700: '#5d5294',
  accent800: '#423a6a',
  accent900: '#2b2741',
  neutral100: '#f3f5fe',
  neutral300: '#cfd3e5',
  neutral600: '#75798c',
  neutral700: '#595d6c',
  neutral800: '#3f424d',
  neutral900: '#292b31',
  // One red for every error
  danger: '#ff8a8a',
  divider: `rgba(${text},0.16)`,
  /** color-mix(text N%, transparent) */
  textAlpha: (percent: number) => `rgba(${text},${percent / 100})`,
  /** color-mix(accent N%, transparent) */
  accentAlpha: (percent: number) => `rgba(${accent},${percent / 100})`,
  scrim: 'rgba(41,43,49,0.58)', // neutral-900 @ 58%
  radiusSm: 4,
  radiusMd: 8,
  radiusLg: 14,
  radiusPopover: 16,
  radiusSheet: 22,
  radiusPill: 999,
};

/** Over video and thumbnails: the same on any ground. */
export const overVideo = {
  // Under a badge or a small label on a picture
  badge: 'rgba(10,11,18,0.72)',
  // A round control over a picture (play, lock)
  glass: 'rgba(14,15,24,0.6)',
  ink: '#e9e9ed',
  inkDim: '#cfd3e5',
  marker: '#d2cefd',
  black: '#0a0b12',
  /** ink at N% */
  inkAlpha: (percent: number) => `rgba(${text},${percent / 100})`,
};

/** Elevation on the dark ground: a hairline edge and ambient darkness (new-architecture boxShadow). */
export const shadows = {
  md: '0 6px 18px rgba(0,0,0,0.55)',
  lg: '0 16px 40px rgba(0,0,0,0.5)',
  drawer: `inset 0 0 0 1px rgba(${text},0.1), -12px 0 48px rgba(0,0,0,0.5), 0 24px 60px rgba(0,0,0,0.4)`,
};

/**
 * A raised panel's edge (a 1 px hairline of edgeColor inside it) and its shadow (boxShadow, outer shadows only).
 * React Native Windows draws only the first boxShadow, as an unclipped rectangle and without inset: the hairline
 * became a light square behind the rounded corners. There the hairline is a border and the shadow the first outer one.
 */
export function raisedEdge(edgeColor: string, shadow: string) {
  return Platform.OS === 'windows'
    ? {
        borderWidth: 1,
        borderColor: edgeColor,
        boxShadow: shadow.split(/,(?![^(]*\))/)[0]!.trim(),
      }
    : { boxShadow: `inset 0 0 0 1px ${edgeColor}, ${shadow}` };
}

/**
 * The borderRadius of a shape rounded all the way at this height (a pill, a circle) with a border of borderWidth.
 * Windows draws a rounded border's corners as squares of radius + borderWidth, which overlap at the sides of a full
 * round (brighter dots there); leaving the border's width out keeps them apart.
 */
export function roundRadius(height: number, borderWidth = 1): number {
  return Platform.OS === 'windows'
    ? Math.max(0, height / 2 - borderWidth)
    : height / 2;
}

// Android names a font by its file; Windows by its family (DirectWrite; the package installs the same files: see
// windows/CoveClient.Package/Package.appxmanifest).
export const fonts =
  Platform.OS === 'windows'
    ? {
        regular: 'Inter',
        medium: 'Inter Medium',
        semiBold: 'Inter SemiBold',
        mono: 'Consolas',
      }
    : {
        regular: 'Inter-Regular',
        medium: 'Inter-Medium',
        semiBold: 'Inter-SemiBold',
        mono: 'monospace',
      };
