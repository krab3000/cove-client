import 'package:flutter/widgets.dart';

import '../theme/tokens.dart';
import 'pressable.dart';

/// Nocturne's segmented control: a 1 px divider frame, radius 8, 40 tall; the chosen option ringed in accent with
/// accent text.
class Segmented<T> extends StatelessWidget {
  const Segmented({
    super.key,
    required this.options,
    required this.value,
    required this.onChanged,
  });

  final List<(T, String)> options;
  final T value;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) => Container(
    height: 40,
    padding: const EdgeInsets.all(2),
    decoration: BoxDecoration(
      borderRadius: BorderRadius.circular(Nocturne.radiusMd),
      border: Border.all(color: Nocturne.divider),
    ),
    child: Row(
      children: [
        for (final (option, label) in options)
          Expanded(
            child: Pressable(
              onPressed: () => onChanged(option),
              semanticLabel: label,
              builder: (context, states) {
                final on = option == value;
                return Container(
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(
                      color: on ? Nocturne.accent : Nocturne.accentAlpha(0),
                    ),
                    color: on
                        ? Nocturne.accentAlpha(10)
                        : states.highlighted
                        ? Nocturne.textAlpha(6)
                        : null,
                  ),
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: inter(
                      13,
                      weight: on ? medium : FontWeight.w400,
                      color: on ? Nocturne.accent200 : Nocturne.textAlpha(75),
                    ),
                  ),
                );
              },
            ),
          ),
      ],
    ),
  );
}
