import 'package:flutter/widgets.dart';

import '../../../theme/tokens.dart';
import '../../../ui/button.dart';
import '../../../ui/icon_button.dart';
import '../../../ui/icons.dart';
import '../../../ui/pressable.dart';
import '../model.dart';

/// Whether the editor sits on a surface (the tablet's drawer), where its rows go a step lighter than on the phone's
/// ground.
class Raised extends InheritedWidget {
  const Raised({super.key, required this.on, required super.child});

  final bool on;

  static bool of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<Raised>()?.on ?? false;

  @override
  bool updateShouldNotify(Raised old) => old.on != on;
}

/// Design 5a: a summary line's pieces as spans; a group token opens that group.
List<InlineSpan> runSpans(
  List<SummaryRun> runs, {
  ValueChanged<Group>? onOpen,
}) => [
  for (final run in runs)
    switch (run) {
      LeadRun(:final text) => TextSpan(
        text: text,
        style: inter(13.5, weight: medium),
      ),
      WordRun(:final text) => TextSpan(
        text: text,
        style: TextStyle(color: Nocturne.textAlpha(50)),
      ),
      TextRun(:final text) => TextSpan(text: text),
      MoreRun(:final count) => TextSpan(
        text: '+ $count more',
        style: const TextStyle(color: Nocturne.accent300),
      ),
      GroupRun(:final group, :final text) => WidgetSpan(
        alignment: PlaceholderAlignment.middle,
        child: Pressable(
          onPressed: onOpen == null ? null : () => onOpen(group),
          semanticLabel: 'Open $text',
          builder: (context, states) => Container(
            margin: const EdgeInsets.symmetric(horizontal: 2),
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
            decoration: BoxDecoration(
              color: Nocturne.accentAlpha(states.highlighted ? 22 : 14),
              borderRadius: BorderRadius.circular(5),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              spacing: 4,
              children: [
                const Icon(
                  Phosphor.bracketsCurly,
                  size: 11,
                  color: Nocturne.accent200,
                ),
                Text(text, style: inter(12, color: Nocturne.accent200)),
                const Icon(
                  Phosphor.caretRight,
                  size: 8,
                  color: Nocturne.accent200,
                ),
              ],
            ),
          ),
        ),
      ),
    },
];

/// A row's ⋮ (small).
class _More extends StatelessWidget {
  const _More({required this.onPressed, this.label = 'Menu'});

  final VoidCallback onPressed;
  final String label;

  @override
  Widget build(BuildContext context) => CoveIconButton(
    icon: Phosphor.dotsThreeVertical,
    onPressed: onPressed,
    semanticLabel: label,
    box: 34,
    iconSize: 18,
    color: Nocturne.textAlpha(45),
  );
}

/// An operator pill: tap cycles All of / Any of / Just one of / None of.
class OpPill extends StatelessWidget {
  const OpPill({
    super.key,
    required this.group,
    required this.onCycle,
    this.root = false,
  });

  final Group group;
  final VoidCallback onCycle;
  final bool root;

  @override
  Widget build(BuildContext context) => Pressable(
    onPressed: onCycle,
    semanticLabel: '${groupLabels[group.op]}, change',
    builder: (context, states) => Container(
      height: root ? 34 : 30,
      padding: EdgeInsets.symmetric(horizontal: root ? 12 : 10),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(Nocturne.radiusMd),
        border: Border.all(color: Nocturne.accent),
        color: states.pressed
            ? Nocturne.accentAlpha(16)
            : states.highlighted
            ? Nocturne.accentAlpha(8)
            : null,
        boxShadow: root
            ? [BoxShadow(color: Nocturne.accentAlpha(25), blurRadius: 12)]
            : null,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        spacing: 6,
        children: [
          Text(
            groupLabels[group.op]!,
            style: inter(
              root ? 13 : 12.5,
              weight: medium,
              color: Nocturne.accent200,
            ),
          ),
          Icon(
            Phosphor.caretUpDown,
            size: root ? 13 : 12,
            color: Nocturne.accent200,
          ),
        ],
      ),
    ),
  );
}

class CutTag extends StatelessWidget {
  const CutTag({super.key});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
    decoration: BoxDecoration(
      color: Nocturne.neutral800,
      borderRadius: BorderRadius.circular(5),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      spacing: 4,
      children: [
        const Icon(
          Phosphor.scissors,
          size: 10,
          color: NocturneExtra.neutral300,
        ),
        Text('Cut', style: inter(10.5, color: NocturneExtra.neutral300)),
      ],
    ),
  );
}

/// The frame of a row: the surface (a step lighter in the drawer); a cut row dimmed, dashed.
class _RowFrame extends StatelessWidget {
  const _RowFrame({
    required this.onPressed,
    required this.label,
    required this.child,
    this.cut = false,
    this.ring = false,
    this.padding = const EdgeInsets.symmetric(vertical: 9, horizontal: 12),
  });

  final VoidCallback onPressed;
  final String label;
  final Widget child;
  final bool cut;
  final bool ring;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final raised = Raised.of(context);
    return Opacity(
      opacity: cut ? 0.6 : 1,
      child: Pressable(
        onPressed: onPressed,
        semanticLabel: label,
        builder: (context, states) => Container(
          padding: padding,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(Nocturne.radiusMd),
            color: cut
                ? null
                : Color.alphaBlend(
                    Nocturne.textAlpha(
                      states.pressed
                          ? 6
                          : states.highlighted
                          ? 3
                          : 0,
                    ),
                    raised ? NocturneExtra.raised : Nocturne.surface,
                  ),
            border: ring
                ? Border.all(color: Nocturne.accent)
                : cut
                ? Border.all(color: Nocturne.textAlpha(30))
                : null,
            boxShadow: ring
                ? [BoxShadow(color: Nocturne.accentAlpha(22), blurRadius: 24)]
                : null,
          ),
          child: child,
        ),
      ),
    );
  }
}

class ConditionRow extends StatelessWidget {
  const ConditionRow({
    super.key,
    required this.condition,
    required this.onPressed,
    required this.onMenu,
    this.cut = false,
  });

  final Condition condition;
  final bool cut;
  final VoidCallback onPressed;
  final VoidCallback onMenu;

  @override
  Widget build(BuildContext context) {
    final row = rowText(condition);
    return _RowFrame(
      onPressed: onPressed,
      label: summary(condition),
      cut: cut,
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  spacing: 6,
                  children: [
                    Text(
                      row.label,
                      style: inter(11.5, color: Nocturne.textAlpha(50)),
                    ),
                    if (cut) const CutTag(),
                  ],
                ),
                Text.rich(
                  TextSpan(
                    style: inter(14),
                    children: [
                      for (final run in row.runs)
                        if (run.folder)
                          WidgetSpan(
                            alignment: PlaceholderAlignment.middle,
                            child: Icon(
                              Phosphor.fill(Phosphor.folder),
                              size: 14,
                              color: Nocturne.accent,
                            ),
                          )
                        else if (run.sep)
                          WidgetSpan(
                            alignment: PlaceholderAlignment.middle,
                            child: Icon(
                              Phosphor.caretRight,
                              size: 10,
                              color: Nocturne.textAlpha(45),
                            ),
                          )
                        else
                          TextSpan(
                            text: run.text,
                            style: run.mono
                                ? mono(
                                    13,
                                    color: run.muted
                                        ? Nocturne.textAlpha(55)
                                        : Nocturne.text,
                                  )
                                : run.muted
                                ? TextStyle(color: Nocturne.textAlpha(55))
                                : null,
                          ),
                    ],
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (row.resolved != null)
                  Text(
                    row.resolved!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: row.resolvedMono
                        ? mono(11.5, color: Nocturne.accent300)
                        : inter(11.5, color: Nocturne.accent300),
                  ),
              ],
            ),
          ),
          _More(onPressed: onMenu),
        ],
      ),
    );
  }
}

/// Design 5b: a group two levels down, as one row: operator, count and its short summary. Tap opens it.
class GroupRow extends StatelessWidget {
  const GroupRow({
    super.key,
    required this.group,
    required this.onPressed,
    required this.onMenu,
    this.cut = false,
    this.ring = false,
  });

  final Group group;
  final bool cut;
  final bool ring;
  final VoidCallback onPressed;
  final VoidCallback onMenu;

  @override
  Widget build(BuildContext context) {
    final inside = conditionCount(group);
    final phrase = groupPhrase(group);
    return _RowFrame(
      onPressed: onPressed,
      label: summary(group),
      cut: cut,
      ring: ring,
      padding: const EdgeInsets.fromLTRB(10, 9, 8, 9),
      child: Row(
        spacing: 10,
        children: [
          Container(
            width: 32,
            height: 32,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: Nocturne.accentAlpha(14),
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Icon(
              Phosphor.bracketsCurly,
              size: 16,
              color: Nocturne.accent300,
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  spacing: 6,
                  children: [
                    Text.rich(
                      TextSpan(
                        style: inter(11.5, color: Nocturne.textAlpha(50)),
                        children: [
                          TextSpan(
                            text: groupLabels[group.op],
                            style: inter(
                              11.5,
                              weight: medium,
                              color: Nocturne.accent200,
                            ),
                          ),
                          TextSpan(
                            text:
                                ' · $inside condition${inside == 1 ? '' : 's'}',
                          ),
                        ],
                      ),
                    ),
                    if (cut) const CutTag(),
                  ],
                ),
                const SizedBox(height: 1),
                Text.rich(
                  phrase.isEmpty
                      ? const TextSpan(text: 'Empty · tap to add to it')
                      : TextSpan(children: runSpans(phrase)),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: inter(13, height: 13 * 1.45),
                ),
              ],
            ),
          ),
          Icon(Phosphor.caretRight, size: 14, color: Nocturne.textAlpha(55)),
          _More(onPressed: onMenu),
        ],
      ),
    );
  }
}

/// Design 5e: one "+ Add" per group (Condition / Subgroup / Paste in a sheet); Paste stays beside it as a shortcut.
class AddRow extends StatelessWidget {
  const AddRow({
    super.key,
    required this.group,
    required this.canPasteHere,
    required this.onAdd,
    required this.onPaste,
    this.compact = false,
  });

  final Group group;
  final bool canPasteHere;
  final bool compact;
  final VoidCallback onAdd;
  final VoidCallback onPaste;

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.only(top: compact ? 0 : 6),
    child: Wrap(
      spacing: compact ? 4 : 6,
      runSpacing: 4,
      children: [
        CoveButton(
          label: 'Add',
          icon: Phosphor.plus,
          variant: ButtonVariant.text,
          size: ButtonSize.sm,
          onPressed: onAdd,
        ),
        if (canPasteHere)
          Pressable(
            onPressed: onPaste,
            semanticLabel: 'Paste',
            builder: (context, states) => Container(
              height: compact ? 34 : 36,
              padding: EdgeInsets.symmetric(horizontal: compact ? 10 : 12),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(Nocturne.radiusMd),
                border: Border.all(color: Nocturne.accentAlpha(45)),
                color: states.pressed || states.highlighted
                    ? Nocturne.accentAlpha(10)
                    : null,
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                spacing: 6,
                children: [
                  const Icon(
                    Phosphor.clipboardText,
                    size: 14,
                    color: Nocturne.accent200,
                  ),
                  Text('Paste', style: inter(13, color: Nocturne.accent200)),
                ],
              ),
            ),
          ),
      ],
    ),
  );
}

/// The guide line down a group's children, and the children 16 px in.
class Indented extends StatelessWidget {
  const Indented({super.key, required this.children, this.guideBottom = 22});

  final List<Widget> children;
  final double guideBottom;

  @override
  Widget build(BuildContext context) => Stack(
    children: [
      Positioned(
        left: 5,
        top: 0,
        bottom: guideBottom,
        width: 1,
        child: ColoredBox(color: Nocturne.divider),
      ),
      Padding(
        padding: const EdgeInsets.only(left: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          spacing: 6,
          children: children,
        ),
      ),
    ],
  );
}

/// A group one level down: its pill (tap cycles) and ⋮, then its children; groups inside it are rows that open.
class Subgroup extends StatelessWidget {
  const Subgroup({
    super.key,
    required this.group,
    required this.cutId,
    required this.cameFrom,
    required this.canPasteInto,
    required this.onCycle,
    required this.onEdit,
    required this.onMenu,
    required this.onOpen,
    required this.onAdd,
    required this.onPaste,
  });

  final Group group;
  final String? cutId;
  final String? cameFrom;
  final bool Function(String groupId) canPasteInto;
  final ValueChanged<Group> onCycle;
  final void Function(String groupId, Condition condition) onEdit;
  final ValueChanged<Node> onMenu;
  final ValueChanged<Group> onOpen;
  final ValueChanged<Group> onAdd;
  final ValueChanged<String> onPaste;

  @override
  Widget build(BuildContext context) {
    final cut = group.id == cutId;
    return Opacity(
      opacity: cut ? 0.6 : 1,
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(Nocturne.radiusMd),
          color: group.id == cameFrom ? Nocturne.accentAlpha(9) : null,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 4, bottom: 6),
              child: Row(
                spacing: 8,
                children: [
                  OpPill(group: group, onCycle: () => onCycle(group)),
                  if (cut) const CutTag(),
                  const Spacer(),
                  _More(onPressed: () => onMenu(group), label: 'Group menu'),
                ],
              ),
            ),
            Indented(
              guideBottom: 20,
              children: [
                for (final child in group.children)
                  switch (child) {
                    Condition() => ConditionRow(
                      key: ValueKey(child.id),
                      condition: child,
                      cut: child.id == cutId,
                      onPressed: () => onEdit(group.id, child),
                      onMenu: () => onMenu(child),
                    ),
                    Group() => GroupRow(
                      key: ValueKey(child.id),
                      group: child,
                      cut: child.id == cutId,
                      ring: child.id == cameFrom,
                      onPressed: () => onOpen(child),
                      onMenu: () => onMenu(child),
                    ),
                  },
                AddRow(
                  group: group,
                  compact: true,
                  canPasteHere: canPasteInto(group.id),
                  onAdd: () => onAdd(group),
                  onPaste: () => onPaste(group.id),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
