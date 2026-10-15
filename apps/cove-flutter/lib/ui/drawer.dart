import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import '../theme/tokens.dart';
import 'icon_button.dart';

const _inset = 12.0;
// A drag right this far (or this fast) closes it
const _swipeClose = 90.0;
const _swipeVelocity = 500.0;

/// A temporary panel over the right of its [Stack] (design 1o): it floats inset from the edges, opaque and lifted by
/// a shadow, slides in when [open] and out when not, and closes on a drag right or Escape.
class CoveDrawer extends StatefulWidget {
  const CoveDrawer({
    super.key,
    required this.open,
    required this.onClose,
    required this.child,
    this.width = 360,
  });

  final bool open;
  final VoidCallback onClose;
  final double width;
  final Widget child;

  @override
  State<CoveDrawer> createState() => _CoveDrawerState();
}

class _CoveDrawerState extends State<CoveDrawer>
    with SingleTickerProviderStateMixin {
  late final _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 340),
    reverseDuration: const Duration(milliseconds: 220),
    value: widget.open ? 1 : 0,
  );
  late final _slide = CurvedAnimation(
    parent: _controller,
    curve: const Cubic(0.2, 0.8, 0.2, 1),
    reverseCurve: Curves.easeInQuad,
  );
  // How far right a drag has moved it
  double _drag = 0;

  @override
  void didUpdateWidget(CoveDrawer old) {
    super.didUpdateWidget(old);
    if (widget.open != old.open) {
      _drag = 0;
      widget.open ? _controller.forward() : _controller.reverse();
    }
  }

  @override
  void dispose() {
    _slide.dispose();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final away = widget.width + 2 * _inset;
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        if (_controller.isDismissed) return const SizedBox.shrink();
        final shift = (1 - _slide.value) * away + _drag;
        return Positioned(
          top: _inset,
          right: _inset,
          bottom: _inset,
          width: widget.width,
          child: Opacity(
            opacity: (1 - shift / away).clamp(0.0, 1.0),
            child: Transform.translate(offset: Offset(shift, 0), child: child),
          ),
        );
      },
      child: GestureDetector(
        onHorizontalDragUpdate: (d) =>
            setState(() => _drag = (_drag + d.delta.dx).clamp(0.0, away)),
        onHorizontalDragEnd: (d) {
          if (_drag > _swipeClose ||
              d.velocity.pixelsPerSecond.dx > _swipeVelocity) {
            widget.onClose();
          } else {
            setState(() => _drag = 0);
          }
        },
        child: CallbackShortcuts(
          bindings: {
            const SingleActivator(LogicalKeyboardKey.escape): widget.onClose,
          },
          child: FocusScope(
            child: Container(
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(
                color: Nocturne.surface,
                borderRadius: BorderRadius.circular(Nocturne.radiusSheet),
                boxShadow: raisedShadow,
              ),
              foregroundDecoration: BoxDecoration(
                borderRadius: BorderRadius.circular(Nocturne.radiusSheet),
                border: Border.all(color: Nocturne.textAlpha(10)),
              ),
              child: widget.child,
            ),
          ),
        ),
      ),
    );
  }
}

/// A drawer's header: its title and ✕.
class PanelHeader extends StatelessWidget {
  const PanelHeader({super.key, required this.title, required this.onClose});

  final String title;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 14, 12, 4),
    child: Row(
      children: [
        Expanded(
          child: Text(
            title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: inter(17, weight: medium),
          ),
        ),
        CloseIconButton(onPressed: onClose),
      ],
    ),
  );
}
