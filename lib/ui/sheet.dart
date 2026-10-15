import 'package:flutter/material.dart'
    show Material, MaterialType, showModalBottomSheet, showGeneralDialog;
import 'package:flutter/widgets.dart';

import '../theme/tokens.dart';
import 'icon_button.dart';
import 'misc.dart';
import 'popover.dart';
import 'pressable.dart';

const _scrim = Color(0x94292B31); // neutral-900 @ 58%

/// A bottom sheet (Nocturne): the surface, 22 px top corners, a grabber, a scrim over the screen; a tap above it or
/// back closes it. On a wide screen it is set in from the sides (at most 640 wide).
Future<T?> showSheet<T>(
  BuildContext context, {
  required WidgetBuilder builder,
}) => showModalBottomSheet<T>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  backgroundColor: Nocturne.surface,
  barrierColor: _scrim,
  constraints: const BoxConstraints(maxWidth: 640),
  shape: const RoundedRectangleBorder(
    borderRadius: BorderRadius.vertical(
      top: Radius.circular(Nocturne.radiusSheet),
    ),
  ),
  builder: (context) => DefaultTextStyle(
    style: inter(15),
    child: Padding(
      // Over the keyboard, and clear of the system's gesture bar
      padding: EdgeInsets.only(
        bottom:
            MediaQuery.viewInsetsOf(context).bottom +
            MediaQuery.paddingOf(context).bottom,
      ),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.85,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Grabber(),
            Flexible(child: builder(context)),
          ],
        ),
      ),
    ),
  ),
);

class Grabber extends StatelessWidget {
  const Grabber({super.key});

  @override
  Widget build(BuildContext context) => Center(
    child: Container(
      margin: const EdgeInsets.only(top: 8, bottom: 6),
      width: 40,
      height: 4,
      decoration: BoxDecoration(
        color: const Color(0xFF595D6C), // neutral-700
        borderRadius: BorderRadius.circular(2),
      ),
    ),
  );
}

/// A sheet's heading: 17 px, with what it is about under it.
class SheetHeading extends StatelessWidget {
  const SheetHeading(this.title, {super.key, this.detail});

  final String title;
  final String? detail;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 6, 20, 8),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: inter(17, weight: medium)),
        if (detail != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              detail!,
              style: inter(13, color: Nocturne.textAlpha(60), height: 19),
            ),
          ),
      ],
    ),
  );
}

/// A menu's entries as rows (a sheet's, 48 px; with a caption above): [MenuEntry]s and [Rule]s. Picking one closes
/// the menu ([onClose]) and runs it.
class MenuList extends StatelessWidget {
  const MenuList({
    super.key,
    required this.entries,
    required this.onClose,
    this.caption,
  });

  final List<Object> entries;
  final VoidCallback onClose;
  final String? caption;

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    padding: const EdgeInsets.fromLTRB(8, 0, 8, 12),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (caption != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 4, 12, 10),
            child: Text(
              caption!,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: inter(12.5, color: Nocturne.textAlpha(55)),
            ),
          ),
        for (final entry in entries)
          if (entry is MenuEntry)
            MenuRow(
              entry: entry,
              onPressed: () {
                onClose();
                entry.onPressed();
              },
            )
          else if (entry is Rule)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 4),
              child: Rule(),
            )
          else
            entry as Widget,
      ],
    ),
  );
}

/// A menu's row: accent-300 icon, 15 px label, a 12 px detail; a check on the current one.
class MenuRow extends StatelessWidget {
  const MenuRow({
    super.key,
    required this.entry,
    required this.onPressed,
    this.height = 48,
  });

  final MenuEntry entry;
  final VoidCallback onPressed;
  final double height;

  @override
  Widget build(BuildContext context) => Pressable(
    onPressed: onPressed,
    semanticLabel: entry.label,
    builder: (context, states) => Container(
      constraints: BoxConstraints(
        minHeight: entry.detail != null ? height + 8 : height,
      ),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(Nocturne.radiusMd),
        color: states.pressed
            ? Nocturne.textAlpha(10)
            : states.highlighted
            ? Nocturne.textAlpha(6)
            : null,
      ),
      child: Row(
        children: [
          Icon(entry.icon, size: 18, color: Nocturne.accent300),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  entry.label,
                  style: inter(
                    15,
                    weight: entry.selected ? medium : FontWeight.w400,
                    color: entry.selected ? Nocturne.accent200 : Nocturne.text,
                  ),
                ),
                if (entry.detail != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      entry.detail!,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: inter(12, color: Nocturne.textAlpha(55)),
                    ),
                  ),
              ],
            ),
          ),
          if (entry.meta != null)
            Padding(
              padding: const EdgeInsets.only(left: 8),
              child: Text(
                entry.meta!,
                style: inter(12.5, color: Nocturne.textAlpha(50)),
              ),
            ),
          if (entry.selected)
            const Padding(
              padding: EdgeInsets.only(left: 8),
              child: Icon(
                IconData(0xe182, fontFamily: 'Phosphor'),
                size: 18,
                color: Nocturne.accent,
              ),
            ),
        ],
      ),
    ),
  );
}

/// A phone's menu (the filter editor's ⋮, the server's ⋮): a bottom sheet of [MenuList].
Future<void> showMenuSheet(
  BuildContext context, {
  required List<Object> entries,
  String? caption,
}) => showSheet<void>(
  context,
  builder: (sheet) => MenuList(
    entries: entries,
    caption: caption,
    onClose: () => Navigator.of(sheet).pop(),
  ),
);

/// A sheet inside a panel (the tablet filter drawer's menus, 9a/9b): it rises from the panel's bottom over its content
/// dimmed; a tap above it closes it. Put it last in the panel's Stack; null [child] hides it.
class InlineSheet extends StatelessWidget {
  const InlineSheet({super.key, required this.child, required this.onClose});

  final Widget? child;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final open = child != null;
    return Positioned.fill(
      child: IgnorePointer(
        ignoring: !open,
        child: Stack(
          children: [
            Positioned.fill(
              child: GestureDetector(
                onTap: onClose,
                child: AnimatedOpacity(
                  opacity: open ? 1 : 0,
                  duration: const Duration(milliseconds: 180),
                  child: const ColoredBox(color: _scrim),
                ),
              ),
            ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: AnimatedSlide(
                offset: open ? Offset.zero : const Offset(0, 1),
                duration: const Duration(milliseconds: 220),
                curve: Curves.easeOutCubic,
                child: Container(
                  constraints: BoxConstraints(
                    maxHeight: MediaQuery.sizeOf(context).height * 0.7,
                  ),
                  decoration: const BoxDecoration(
                    color: Nocturne.surface,
                    borderRadius: BorderRadius.vertical(
                      top: Radius.circular(Nocturne.radiusSheet),
                    ),
                    boxShadow: [
                      BoxShadow(color: Color(0x66000000), blurRadius: 24),
                    ],
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Grabber(),
                      if (child != null) Flexible(child: child!),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A tablet's dialog (Settings' value, Save as): 420 wide, radius 22, a title and ✕; a tap outside closes it.
Future<T?> showCoveDialog<T>(
  BuildContext context, {
  required String title,
  required WidgetBuilder builder,
  double width = 420,
}) => showGeneralDialog<T>(
  context: context,
  barrierDismissible: true,
  barrierLabel: 'Close',
  barrierColor: _scrim,
  transitionDuration: const Duration(milliseconds: 150),
  transitionBuilder: (context, animation, _, child) =>
      FadeTransition(opacity: animation, child: child),
  // A Material under it: a text field needs one (Save as's name), and a dialog has none of its own
  pageBuilder: (dialog, _, _) => Material(
    type: MaterialType.transparency,
    child: DefaultTextStyle(
      style: inter(15),
      child: Center(
        child: Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.viewInsetsOf(dialog).bottom,
          ),
          child: Container(
            width: width,
            constraints: BoxConstraints(
              maxHeight: MediaQuery.sizeOf(dialog).height * 0.85,
            ),
            decoration: BoxDecoration(
              color: Nocturne.surface,
              borderRadius: BorderRadius.circular(Nocturne.radiusSheet),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x99000000),
                  offset: Offset(0, 24),
                  blurRadius: 60,
                ),
              ],
            ),
            foregroundDecoration: BoxDecoration(
              borderRadius: BorderRadius.circular(Nocturne.radiusSheet),
              border: Border.all(color: Nocturne.textAlpha(10)),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 14, 12, 4),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(title, style: inter(17, weight: medium)),
                      ),
                      CloseIconButton(
                        onPressed: () => Navigator.of(dialog).pop(),
                      ),
                    ],
                  ),
                ),
                Flexible(child: builder(dialog)),
              ],
            ),
          ),
        ),
      ),
    ),
  ),
);
