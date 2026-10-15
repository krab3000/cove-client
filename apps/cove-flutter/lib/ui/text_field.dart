import 'package:flutter/material.dart';

import '../theme/tokens.dart';

/// A text field (Nocturne): 46 tall, the ground under it, a divider outline that turns accent while it has focus.
class CoveTextField extends StatelessWidget {
  const CoveTextField({
    super.key,
    required this.controller,
    this.focusNode,
    this.placeholder,
    this.obscure = false,
    this.autofocus = false,
    this.keyboardType,
    this.textInputAction,
    this.onSubmitted,
  });

  final TextEditingController controller;
  final FocusNode? focusNode;
  final String? placeholder;
  final bool obscure;
  final bool autofocus;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onSubmitted;

  @override
  Widget build(BuildContext context) {
    OutlineInputBorder outline(Color color) => OutlineInputBorder(
      borderRadius: BorderRadius.circular(Nocturne.radiusMd),
      borderSide: BorderSide(color: color),
    );
    return TextField(
      controller: controller,
      focusNode: focusNode,
      obscureText: obscure,
      autofocus: autofocus,
      autocorrect: false,
      enableSuggestions: !obscure,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      onSubmitted: onSubmitted,
      cursorColor: Nocturne.accent,
      // 18 + 2 × 14 padding: 46 tall
      style: inter(15, height: 18),
      decoration: InputDecoration(
        hintText: placeholder,
        hintStyle: inter(15, color: Nocturne.textAlpha(40)),
        filled: true,
        fillColor: Nocturne.bg,
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 14,
          vertical: 14,
        ),
        enabledBorder: outline(Nocturne.divider),
        focusedBorder: outline(Nocturne.accent),
        border: outline(Nocturne.divider),
      ),
    );
  }
}
