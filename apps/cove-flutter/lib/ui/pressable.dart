import 'package:flutter/widgets.dart';

/// Something you press, drawn by [builder] for its state (hovered, focused, pressed, disabled): a pointer click, or
/// Enter / Space with keyboard focus. Null [onPressed] disables it.
class Pressable extends StatefulWidget {
  const Pressable({
    super.key,
    required this.onPressed,
    required this.builder,
    this.semanticLabel,
  });

  final VoidCallback? onPressed;
  final Widget Function(BuildContext context, Set<WidgetState> states) builder;
  final String? semanticLabel;

  @override
  State<Pressable> createState() => _PressableState();
}

class _PressableState extends State<Pressable> {
  bool _hovered = false;
  bool _focused = false;
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onPressed != null;
    final states = <WidgetState>{
      if (!enabled) WidgetState.disabled,
      if (enabled && _hovered) WidgetState.hovered,
      if (enabled && _focused) WidgetState.focused,
      if (enabled && _pressed) WidgetState.pressed,
    };
    return Semantics(
      button: true,
      enabled: enabled,
      label: widget.semanticLabel,
      child: FocusableActionDetector(
        enabled: enabled,
        mouseCursor: enabled ? SystemMouseCursors.click : MouseCursor.defer,
        onShowHoverHighlight: (v) => setState(() => _hovered = v),
        onShowFocusHighlight: (v) => setState(() => _focused = v),
        actions: {
          ActivateIntent: CallbackAction<ActivateIntent>(
            onInvoke: (_) {
              widget.onPressed?.call();
              return null;
            },
          ),
        },
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTapDown: enabled ? (_) => setState(() => _pressed = true) : null,
          onTapUp: enabled ? (_) => setState(() => _pressed = false) : null,
          onTapCancel: enabled ? () => setState(() => _pressed = false) : null,
          onTap: widget.onPressed,
          child: widget.builder(context, states),
        ),
      ),
    );
  }
}

extension PressStates on Set<WidgetState> {
  bool get pressed => contains(WidgetState.pressed);

  /// Hovered, or focused from the keyboard: one highlight for both.
  bool get highlighted =>
      contains(WidgetState.hovered) || contains(WidgetState.focused);
}
