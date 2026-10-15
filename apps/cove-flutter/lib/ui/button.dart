import 'package:flutter/widgets.dart';

import '../theme/tokens.dart';
import 'misc.dart';
import 'pressable.dart';

enum ButtonVariant { primary, secondary, text }

enum ButtonSize { sm, md, lg }

/// Nocturne's buttons: primary (an accent outline, the action), secondary (a divider outline), text (accent text, for
/// row actions like + Add). Sizes 34 / 44 / 50; an optional leading icon; busy shows a spinner in place of the label.
class CoveButton extends StatelessWidget {
  const CoveButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.variant = ButtonVariant.primary,
    this.size = ButtonSize.md,
    this.icon,
    this.busy = false,
    this.disabled = false,
  });

  final String label;
  final VoidCallback onPressed;
  final ButtonVariant variant;
  final ButtonSize size;
  final IconData? icon;
  final bool busy;
  final bool disabled;

  @override
  Widget build(BuildContext context) {
    final ink = switch (variant) {
      ButtonVariant.primary => Nocturne.accent200,
      ButtonVariant.secondary => Nocturne.text,
      ButtonVariant.text => Nocturne.accent300,
    };
    final (height, padding, fontSize) = switch (size) {
      ButtonSize.sm => (34.0, 12.0, 13.0),
      ButtonSize.md => (44.0, 16.0, 14.0),
      ButtonSize.lg => (50.0, 18.0, 15.0),
    };
    return Pressable(
      onPressed: disabled || busy ? null : onPressed,
      semanticLabel: label,
      builder: (context, states) {
        final tint = switch (variant) {
          ButtonVariant.primary =>
            states.pressed
                ? Nocturne.accentAlpha(22)
                : states.highlighted
                ? Nocturne.accentAlpha(12)
                : null,
          ButtonVariant.secondary =>
            states.pressed
                ? Nocturne.textAlpha(12)
                : states.highlighted
                ? Nocturne.textAlpha(7)
                : null,
          ButtonVariant.text =>
            states.pressed
                ? Nocturne.accentAlpha(16)
                : states.highlighted
                ? Nocturne.accentAlpha(10)
                : null,
        };
        return Opacity(
          opacity: disabled ? 0.4 : 1,
          child: Container(
            height: height,
            padding: EdgeInsets.symmetric(
              horizontal: variant == ButtonVariant.text ? 10 : padding,
            ),
            decoration: BoxDecoration(
              color: tint,
              borderRadius: BorderRadius.circular(Nocturne.radiusMd),
              border: switch (variant) {
                ButtonVariant.primary => Border.all(color: Nocturne.accent),
                ButtonVariant.secondary => Border.all(color: Nocturne.divider),
                ButtonVariant.text => null,
              },
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: busy
                  ? [Spinner(color: ink, size: 18)]
                  : [
                      if (icon != null) ...[
                        Icon(icon, size: 16, color: ink),
                        const SizedBox(width: 8),
                      ],
                      Flexible(
                        child: Text(
                          label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: inter(fontSize, weight: medium, color: ink),
                        ),
                      ),
                    ],
            ),
          ),
        );
      },
    );
  }
}
