import 'package:flutter/material.dart' show CircularProgressIndicator;
import 'package:flutter/widgets.dart';

import '../theme/tokens.dart';

/// Cove's icon (coveicon.ico from the Cove repository): the brand mark before "Cove".
class CoveMark extends StatelessWidget {
  const CoveMark({super.key, this.size = 22});

  final double size;

  @override
  Widget build(BuildContext context) => Image.asset(
    'assets/images/cove-icon.png',
    width: size,
    height: size,
    fit: BoxFit.contain,
    semanticLabel: 'Cove',
  );
}

/// A server's or a session's state: lit (with a glow) or not.
class StatusDot extends StatelessWidget {
  const StatusDot({super.key, required this.on});

  final bool on;

  @override
  Widget build(BuildContext context) => Container(
    width: 6,
    height: 6,
    decoration: BoxDecoration(
      shape: BoxShape.circle,
      color: on ? Nocturne.accent : Nocturne.neutral700,
      boxShadow: on
          ? const [BoxShadow(color: Nocturne.accent, blurRadius: 6)]
          : null,
    ),
  );
}

/// Nocturne's rule: 1 px, fading out at both ends.
class Rule extends StatelessWidget {
  const Rule({super.key});

  @override
  Widget build(BuildContext context) => Container(
    height: 1,
    decoration: BoxDecoration(
      gradient: LinearGradient(
        colors: [
          const Color(0x00000000),
          Nocturne.divider,
          Nocturne.divider,
          const Color(0x00000000),
        ],
        stops: const [0, 0.14, 0.86, 1],
      ),
    ),
  );
}

/// What went wrong, in the one red.
class ErrorText extends StatelessWidget {
  const ErrorText(this.text, {super.key, this.textAlign});

  final String text;
  final TextAlign? textAlign;

  @override
  Widget build(BuildContext context) => Text(
    text,
    textAlign: textAlign,
    style: inter(13, color: Nocturne.danger, height: 19),
  );
}

/// Waiting: the accent, by default.
class Spinner extends StatelessWidget {
  const Spinner({super.key, this.color = Nocturne.accent, this.size = 22});

  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) => SizedBox.square(
    dimension: size,
    child: CircularProgressIndicator(strokeWidth: 2, color: color),
  );
}

/// A server's name after its status dot (1b, 1n).
class ServerPill extends StatelessWidget {
  const ServerPill({super.key, required this.name, required this.online});

  final String name;
  final bool online;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      StatusDot(on: online),
      const SizedBox(width: 6),
      Flexible(
        child: Text(
          name,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: inter(13, color: Nocturne.textAlpha(70)),
        ),
      ),
    ],
  );
}
