import 'package:flutter/widgets.dart';

import '../theme/tokens.dart';
import 'pressable.dart';

/// Nocturne's switch: 44×26 (36×22 small). On: an accent-30% track with an inset accent ring, an accent-200 knob;
/// off: a neutral-800 track with a divider ring, a neutral-400 knob.
class Toggle extends StatelessWidget {
  const Toggle({
    super.key,
    required this.on,
    this.onChanged,
    this.small = false,
  });

  final bool on;
  // Null: the row around it toggles
  final ValueChanged<bool>? onChanged;
  final bool small;

  @override
  Widget build(BuildContext context) {
    final w = small ? 36.0 : 44.0, h = small ? 22.0 : 26.0, knob = h - 8;
    final track = AnimatedContainer(
      duration: const Duration(milliseconds: 160),
      width: w,
      height: h,
      padding: const EdgeInsets.all(4),
      alignment: on ? Alignment.centerRight : Alignment.centerLeft,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(h / 2),
        color: on ? Nocturne.accentAlpha(30) : Nocturne.neutral800,
        border: Border.all(color: on ? Nocturne.accent : Nocturne.divider),
      ),
      child: Container(
        width: knob,
        height: knob,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: on
              ? Nocturne.accent200
              : const Color(0xFFB2B6CA), // neutral-400
        ),
      ),
    );
    if (onChanged == null) return track;
    return Pressable(
      onPressed: () => onChanged!(!on),
      semanticLabel: on ? 'On' : 'Off',
      builder: (context, states) => track,
    );
  }
}
