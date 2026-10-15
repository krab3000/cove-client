import 'package:flutter/widgets.dart';

import '../api/models.dart';
import '../theme/tokens.dart';
import '../utils/format.dart';
import 'icons.dart';
import 'pressable.dart';

enum Mark { later, favorite }

/// Save for later (a bookmark) or Favorite (a heart): on = the filled icon in accent, an inset accent ring.
class MarkToggle extends StatelessWidget {
  const MarkToggle({
    super.key,
    required this.kind,
    required this.on,
    required this.onPressed,
    this.square = false,
  });

  final Mark kind;
  final bool on;
  final VoidCallback onPressed;
  // The preview drawer's: 44 square, beside its Play button
  final bool square;

  @override
  Widget build(BuildContext context) {
    final icon = kind == Mark.later ? Phosphor.bookmarkSimple : Phosphor.heart;
    final size = square ? 44.0 : 40.0;
    return Pressable(
      onPressed: onPressed,
      semanticLabel: kind == Mark.later ? 'Save for later' : 'Favorite',
      builder: (context, states) => Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          shape: square ? BoxShape.rectangle : BoxShape.circle,
          borderRadius: square
              ? BorderRadius.circular(Nocturne.radiusMd)
              : null,
          color: on
              ? Nocturne.accentAlpha(states.highlighted ? 18 : 12)
              : states.highlighted
              ? Nocturne.textAlpha(7)
              : null,
          border: Border.all(color: on ? Nocturne.accent : Nocturne.divider),
        ),
        child: Icon(
          on ? Phosphor.fill(icon) : icon,
          size: 18,
          color: on ? Nocturne.accent : Nocturne.textAlpha(75),
        ),
      ),
    );
  }
}

/// A performer: a small avatar with the initial, and the name.
class PersonChip extends StatelessWidget {
  const PersonChip(this.name, {super.key, this.onPressed});

  final String name;
  // A tap adds the person to the filter
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => _Tappable(
    onPressed: onPressed,
    label: name,
    child: Container(
      height: 28,
      margin: const EdgeInsets.only(right: 6),
      padding: const EdgeInsets.only(left: 3, right: 10),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: Nocturne.divider),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 22,
            height: 22,
            alignment: Alignment.center,
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              color: Color(0xFF5D5294), // accent-700
            ),
            child: Text(
              initials(name),
              style: inter(9.5, weight: medium, color: Nocturne.accent100),
            ),
          ),
          const SizedBox(width: 6),
          Text(name, style: inter(12.5)),
        ],
      ),
    ),
  );
}

/// A tag: radius 6, the divider's outline.
class TagChip extends StatelessWidget {
  const TagChip(this.name, {super.key, this.onPressed});

  final String name;
  // A tap adds the tag to the filter
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => _Tappable(
    onPressed: onPressed,
    label: name,
    child: Container(
      height: 28,
      margin: const EdgeInsets.only(right: 6),
      padding: const EdgeInsets.symmetric(horizontal: 10),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: Nocturne.divider),
      ),
      child: Text(name, style: inter(12.5, color: Nocturne.textAlpha(80))),
    ),
  );
}

class _Tappable extends StatelessWidget {
  const _Tappable({
    required this.onPressed,
    required this.label,
    required this.child,
  });

  final VoidCallback? onPressed;
  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) => onPressed == null
      ? child
      : Pressable(
          onPressed: onPressed,
          semanticLabel: 'Add $label to the filter',
          builder: (context, states) =>
              Opacity(opacity: states.pressed ? 0.7 : 1, child: child),
        );
}

/// A choice among a few (operators, values, speeds): 38 tall, the divider's outline; chosen, an accent outline and
/// accent-200 text on accent 12%.
class ChoiceChip extends StatelessWidget {
  const ChoiceChip({
    super.key,
    required this.label,
    required this.on,
    required this.onPressed,
    this.icon,
    this.height = 38,
  });

  final String label;
  final bool on;
  final VoidCallback onPressed;
  final IconData? icon;
  final double height;

  @override
  Widget build(BuildContext context) => Pressable(
    onPressed: onPressed,
    semanticLabel: label,
    builder: (context, states) => Container(
      height: height,
      constraints: const BoxConstraints(minWidth: 56),
      padding: const EdgeInsets.symmetric(horizontal: 14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(Nocturne.radiusMd),
        border: Border.all(color: on ? Nocturne.accent : Nocturne.divider),
        color: on
            ? Nocturne.accentAlpha(12)
            : states.highlighted
            ? Nocturne.textAlpha(6)
            : null,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (icon != null) ...[
            Icon(
              icon,
              size: 15,
              color: on ? Nocturne.accent200 : Nocturne.textAlpha(75),
            ),
            const SizedBox(width: 6),
          ],
          Text(
            label,
            style: inter(
              14,
              weight: on ? medium : FontWeight.w400,
              color: on ? Nocturne.accent200 : Nocturne.text,
            ),
          ),
        ],
      ),
    ),
  );
}

/// A video's group: "Northern Trips · part 3", after a stack.
class GroupLine extends StatelessWidget {
  const GroupLine(this.group, {super.key});

  final Named group;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(right: 10),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Phosphor.stack, size: 14, color: Nocturne.accent300),
        const SizedBox(width: 6),
        Text(
          groupLabel(group),
          style: inter(12.5, color: Nocturne.textAlpha(55)),
        ),
      ],
    ),
  );
}
