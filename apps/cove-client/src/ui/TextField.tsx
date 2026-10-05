import { forwardRef, useState, type ComponentRef } from 'react';
import { StyleSheet, TextInput, type TextInputProps } from 'react-native';
import { fonts, nocturne as n } from '../theme/tokens';

/**
 * A text field (Nocturne): 46 tall, the ground under it, a divider outline that turns accent while it has focus (and
 * red when invalid). Everything else is TextInput's.
 */
export const TextField = forwardRef<
  ComponentRef<typeof TextInput>,
  TextInputProps & { invalid?: boolean; mono?: boolean; flush?: boolean }
>(function TextField(
  { invalid, mono, flush, style, onFocus, onBlur, ...props },
  ref
) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={n.textAlpha(40)}
      {...props}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={[
        styles.field,
        flush && styles.flush,
        mono && styles.mono,
        focused && styles.focused,
        invalid && styles.invalid,
        style,
      ]}
    />
  );
});

const styles = StyleSheet.create({
  field: {
    height: 46,
    paddingHorizontal: 14,
    paddingVertical: 0,
    borderRadius: n.radiusMd,
    borderWidth: 1,
    borderColor: n.divider,
    backgroundColor: n.bg,
    color: n.text,
    fontSize: 15,
    fontFamily: fonts.regular,
  },
  // On a sheet: no ground of its own
  flush: { backgroundColor: 'transparent' },
  mono: { fontFamily: fonts.mono, fontSize: 14 },
  focused: { borderColor: n.accent },
  invalid: { borderColor: n.danger },
});
