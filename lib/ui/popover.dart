import 'package:flutter/widgets.dart';

import '../theme/tokens.dart';
import 'misc.dart';
import 'sheet.dart';

/// An entry of a menu: an icon, a label and what it does; [Rule] entries separate them.
class MenuEntry {
  const MenuEntry({
    required this.icon,
    required this.label,
    required this.onPressed,
    this.detail,
    this.meta,
    this.selected = false,
  });

  final IconData icon;
  final String label;
  final String? detail;
  // At its right end: a count, a view
  final String? meta;
  // The current one: a check
  final bool selected;
  final VoidCallback onPressed;
}

/// A tablet's menu (1n's ⋮): a popover under its opener (over it with [above]), its right edge on the opener's (its
/// left edge with [alignLeft]); a tap outside or Escape closes it. [entries] are [MenuEntry]s and [Rule]s. Completes
/// once it is closed.
Future<void> showPopover(
  BuildContext context, {
  required Rect anchor,
  required List<Object> entries,
  double width = 280,
  bool above = false,
  bool alignLeft = false,
}) {
  return showGeneralDialog<void>(
    context: context,
    barrierDismissible: true,
    barrierLabel: 'Close',
    barrierColor: const Color(0x00000000),
    transitionDuration: const Duration(milliseconds: 120),
    transitionBuilder: (context, animation, _, child) =>
        FadeTransition(opacity: animation, child: child),
    pageBuilder: (context, _, _) {
      final screen = MediaQuery.sizeOf(context);
      final left = (alignLeft ? anchor.left : anchor.right - width).clamp(
        8.0,
        screen.width - width - 8,
      );
      // A route of its own: no text style comes from the screen
      return DefaultTextStyle(
        style: inter(15),
        child: Stack(
          children: [
            Positioned(
              top: above ? null : anchor.bottom + 4,
              bottom: above ? screen.height - anchor.top + 4 : null,
              left: left,
              width: width,
              child: Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: Nocturne.surface,
                  borderRadius: BorderRadius.circular(Nocturne.radiusPopover),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x80000000),
                      offset: Offset(0, 16),
                      blurRadius: 40,
                    ),
                  ],
                ),
                foregroundDecoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(Nocturne.radiusPopover),
                  border: Border.all(color: Nocturne.textAlpha(10)),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    for (final entry in entries)
                      if (entry is MenuEntry)
                        MenuRow(
                          height: 44,
                          entry: entry,
                          onPressed: () {
                            Navigator.of(context).pop();
                            entry.onPressed();
                          },
                        )
                      else
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 4),
                          child: Rule(),
                        ),
                  ],
                ),
              ),
            ),
          ],
        ),
      );
    },
  );
}

/// Any content as a popover by its opener (the player's Playback options above the gear): the surface, radius 16, the
/// drawer's ring and shadow; a tap outside or Escape closes it.
Future<T?> showAnchored<T>(
  BuildContext context, {
  required Rect anchor,
  required WidgetBuilder builder,
  double width = 320,
  bool above = false,
}) {
  return showGeneralDialog<T>(
    context: context,
    barrierDismissible: true,
    barrierLabel: 'Close',
    barrierColor: const Color(0x00000000),
    transitionDuration: const Duration(milliseconds: 120),
    transitionBuilder: (context, animation, _, child) =>
        FadeTransition(opacity: animation, child: child),
    pageBuilder: (popover, _, _) {
      final screen = MediaQuery.sizeOf(popover);
      final left = (anchor.right - width).clamp(8.0, screen.width - width - 8);
      return DefaultTextStyle(
        style: inter(15),
        child: Stack(
          children: [
            Positioned(
              top: above ? null : anchor.bottom + 6,
              bottom: above ? screen.height - anchor.top + 6 : null,
              left: left,
              width: width,
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  maxHeight:
                      (above ? anchor.top : screen.height - anchor.bottom) - 24,
                ),
                child: Container(
                  padding: const EdgeInsets.only(top: 12),
                  decoration: BoxDecoration(
                    color: Nocturne.surface,
                    borderRadius: BorderRadius.circular(Nocturne.radiusPopover),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x80000000),
                        offset: Offset(0, 16),
                        blurRadius: 40,
                      ),
                    ],
                  ),
                  foregroundDecoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(Nocturne.radiusPopover),
                    border: Border.all(color: Nocturne.textAlpha(10)),
                  ),
                  child: builder(popover),
                ),
              ),
            ),
          ],
        ),
      );
    },
  );
}
