import 'package:flutter/widgets.dart';

import '../theme/tokens.dart';
import 'icons.dart';
import 'pressable.dart';

/// An icon you press: plain (no ground) or round (a faint disc: close). Sizes 34 / 40 / 44.
class CoveIconButton extends StatelessWidget {
  const CoveIconButton({
    super.key,
    required this.icon,
    required this.onPressed,
    required this.semanticLabel,
    this.box = 44,
    this.iconSize = 22,
    this.round = false,
    this.color = Nocturne.text,
    this.active = false,
    this.outlined = false,
  });

  final IconData icon;
  final VoidCallback onPressed;
  final String semanticLabel;
  final double box;
  final double iconSize;
  final bool round;
  final Color color;
  // Its menu is open: it stays pressed
  final bool active;
  // A divider ring (the player's back)
  final bool outlined;

  @override
  Widget build(BuildContext context) => Pressable(
    onPressed: onPressed,
    semanticLabel: semanticLabel,
    builder: (context, states) {
      final on = states.pressed || active;
      return Container(
        width: box,
        height: box,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(
            round ? box / 2 : (outlined ? 10 : Nocturne.radiusMd),
          ),
          border: outlined ? Border.all(color: Nocturne.divider) : null,
          color: round
              ? Nocturne.textAlpha(on ? 14 : (states.highlighted ? 11 : 8))
              : on
              ? Nocturne.textAlpha(10)
              : states.highlighted
              ? Nocturne.textAlpha(6)
              : null,
        ),
        child: Icon(icon, size: iconSize, color: color),
      );
    },
  );
}

/// ✕: closes a drawer or a panel.
class CloseIconButton extends StatelessWidget {
  const CloseIconButton({super.key, required this.onPressed});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => CoveIconButton(
    icon: Phosphor.x,
    onPressed: onPressed,
    semanticLabel: 'Close',
    box: 34,
    iconSize: 16,
    round: true,
  );
}

/// ⋮: a row's menu.
class MoreButton extends StatelessWidget {
  const MoreButton({
    super.key,
    required this.onPressed,
    required this.semanticLabel,
    this.active = false,
  });

  final VoidCallback onPressed;
  final String semanticLabel;
  final bool active;

  @override
  Widget build(BuildContext context) => CoveIconButton(
    icon: Phosphor.dotsThreeVertical,
    onPressed: onPressed,
    semanticLabel: semanticLabel,
    box: 40,
    iconSize: 18,
    color: active ? Nocturne.text : Nocturne.textAlpha(45),
    active: active,
  );
}
