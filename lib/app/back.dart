import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

/// Who handles back (Android's back, Escape on a desktop): the topmost layer first; in a layer, the latest handler.
/// A handler returns false to pass it on.
enum Layer {
  screen(0),
  drawer(10),
  editor(20),
  player(100),
  settings(150);

  const Layer(this.rank);
  final int rank;
}

class _Handler {
  _Handler(this.layer, this.handle, this.order);
  final Layer layer;
  final bool Function() handle;
  final int order;
}

class BackStack {
  final _handlers = <_Handler>[];
  int _order = 0;

  /// Adds a handler; returns its removal.
  void Function() add(Layer layer, bool Function() handle) {
    final handler = _Handler(layer, handle, _order++);
    _handlers.add(handler);
    return () => _handlers.remove(handler);
  }

  /// Back: whether someone took it.
  bool back() {
    final sorted = [..._handlers]
      ..sort(
        (a, b) => a.layer.rank != b.layer.rank
            ? b.layer.rank - a.layer.rank
            : b.order - a.order,
      );
    for (final h in sorted) {
      if (h.handle()) return true;
    }
    return false;
  }
}

final backStack = BackStack();

/// While mounted and [enabled], back runs [onBack] at [layer] (it takes it: return nothing).
class BackHandler extends StatefulWidget {
  const BackHandler({
    super.key,
    required this.layer,
    required this.enabled,
    required this.onBack,
    required this.child,
  });

  final Layer layer;
  final bool enabled;
  final VoidCallback onBack;
  final Widget child;

  @override
  State<BackHandler> createState() => _BackHandlerState();
}

class _BackHandlerState extends State<BackHandler> {
  void Function()? _remove;

  @override
  void initState() {
    super.initState();
    _remove = backStack.add(widget.layer, () {
      if (!widget.enabled) return false;
      widget.onBack();
      return true;
    });
  }

  @override
  void dispose() {
    _remove?.call();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// At the app's root: Android's back button and Escape go to [backStack]; nothing taking it leaves the app.
class BackRoot extends StatelessWidget {
  const BackRoot({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: false,
    onPopInvokedWithResult: (didPop, _) {
      if (didPop) return;
      if (!backStack.back()) SystemNavigator.pop();
    },
    child: CallbackShortcuts(
      bindings: {
        const SingleActivator(LogicalKeyboardKey.escape): () =>
            backStack.back(),
      },
      child: child,
    ),
  );
}
