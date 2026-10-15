import 'package:flutter/widgets.dart';

import '../../../state/sign_in.dart';
import '../../../theme/tokens.dart';
import '../../../ui/button.dart';
import '../../../ui/icons.dart';
import '../../../ui/misc.dart';
import '../../../utils/format.dart';

/// A tablet's right pane for a server that doesn't answer: what is known, and what to do.
class Unreachable extends StatelessWidget {
  const Unreachable({
    super.key,
    required this.server,
    required this.onEdit,
    required this.onRetry,
  });

  final KeptServer server;
  final VoidCallback onEdit;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final lastReached = server.lastReached;
    return CenteredPane(
      children: [
        Container(
          width: 56,
          height: 56,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: Nocturne.textAlpha(6),
            borderRadius: BorderRadius.circular(Nocturne.radiusLg),
          ),
          child: Icon(Phosphor.plugs, size: 26, color: Nocturne.textAlpha(60)),
        ),
        const SizedBox(height: 6),
        ServerPill(name: server.name, online: false),
        PaneTitle("Can't reach ${server.name}"),
        PaneText(
          '${lastReached != null ? 'Last reached ${ago(lastReached)} at ${server.address}. ' : 'Nothing answered at ${server.address}. '}'
          'Check that it is on, and on this network.',
        ),
        const SizedBox(height: 10),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            CoveButton(
              label: 'Edit server',
              variant: ButtonVariant.secondary,
              size: ButtonSize.lg,
              onPressed: onEdit,
            ),
            const SizedBox(width: 8),
            CoveButton(
              label: 'Try again',
              size: ButtonSize.lg,
              onPressed: onRetry,
            ),
          ],
        ),
      ],
    );
  }
}

/// A tablet's right pane for a state with no accounts to show: centred, 10 apart.
class CenteredPane extends StatelessWidget {
  const CenteredPane({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Center(
    child: SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 48, vertical: 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        spacing: 10,
        children: children,
      ),
    ),
  );
}

class PaneTitle extends StatelessWidget {
  const PaneTitle(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Text(
    text,
    textAlign: TextAlign.center,
    style: inter(24, weight: medium, height: 30),
  );
}

class PaneText extends StatelessWidget {
  const PaneText(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => ConstrainedBox(
    constraints: const BoxConstraints(maxWidth: 420),
    child: Text(
      text,
      textAlign: TextAlign.center,
      style: inter(14, color: Nocturne.textAlpha(60), height: 21),
    ),
  );
}
