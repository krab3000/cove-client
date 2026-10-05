// Nocturne, the design system of the Cove Mobile design (design_handoff_cove_mobile/design/tokens/nocturne.css): the
// tokens the filter screens use. Fonts are in android/app/src/main/assets/fonts (fontFamily = file name).

const text = '233,233,237'; // #e9e9ed
const accent = '145,132,217'; // #9184d9

export const nocturne = {
  bg: '#161826',
  surface: '#232532',
  text: '#e9e9ed',
  accent: '#9184d9',
  accent100: '#f5f4ff',
  accent200: '#e7e5fe',
  accent300: '#d2cefd',
  accent700: '#5d5294',
  accent800: '#423a6a',
  accent900: '#2b2741',
  neutral300: '#cfd3e5',
  neutral700: '#595d6c',
  neutral800: '#3f424d',
  neutral900: '#292b31',
  divider: `rgba(${text},0.16)`,
  /** color-mix(text N%, transparent) */
  textAlpha: (percent: number) => `rgba(${text},${percent / 100})`,
  /** color-mix(accent N%, transparent) */
  accentAlpha: (percent: number) => `rgba(${accent},${percent / 100})`,
  scrim: 'rgba(41,43,49,0.58)', // neutral-900 @ 58%
  radiusMd: 8,
  radiusSheet: 22,
};

export const fonts = {
  regular: 'Inter-Regular',
  medium: 'Inter-Medium',
  semiBold: 'Inter-SemiBold',
  mono: 'monospace',
};
