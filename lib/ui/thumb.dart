import 'package:flutter/widgets.dart';

import '../theme/tokens.dart';
import 'icons.dart';

// Over video and thumbnails: the same on any ground
const _badge = Color(0xB80A0B12); // rgba(10,11,18,.72)
const _ink = Color(0xFFE9E9ED);
const _marker = Color(0xFFD2CEFD);

/// Over a cover, bottom right: "resolution · duration". Small on tiles, medium on list cards and the preview.
class ThumbBadge extends StatelessWidget {
  const ThumbBadge(this.text, {super.key, this.large = false});

  final String text;
  final bool large;

  @override
  Widget build(BuildContext context) {
    if (text.isEmpty) return const SizedBox.shrink();
    final inset = large ? 8.0 : 4.0;
    return Positioned(
      right: inset,
      bottom: inset,
      child: Container(
        padding: EdgeInsets.symmetric(
          horizontal: large ? 7 : 4,
          vertical: large ? 2 : 0,
        ),
        decoration: BoxDecoration(
          color: _badge,
          borderRadius: BorderRadius.circular(large ? 5 : 3),
        ),
        child: Text(
          text,
          style: inter(
            large ? 11.5 : 10,
            weight: medium,
            color: _ink,
          ).copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
        ),
      ),
    );
  }
}

/// Over a cover, top left: the user's rating in stars ("4.5").
class RatingPill extends StatelessWidget {
  const RatingPill(this.stars, {super.key});

  final String stars;

  @override
  Widget build(BuildContext context) => Positioned(
    left: 8,
    top: 8,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: _badge,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Phosphor.fill(Phosphor.star), size: 11, color: _marker),
          const SizedBox(width: 4),
          Text(
            stars,
            style: inter(11.5, weight: medium, color: _ink),
          ),
        ],
      ),
    ),
  );
}

/// Along a cover's bottom edge: how much was watched (0–1), with the accent's glow.
class ResumeBar extends StatelessWidget {
  const ResumeBar(this.progress, {super.key, this.height = 2});

  final double progress;
  final double height;

  @override
  Widget build(BuildContext context) => Positioned(
    left: 0,
    right: 0,
    bottom: 0,
    height: height,
    child: IgnorePointer(
      child: ColoredBox(
        color: const Color(0x80000000),
        child: FractionallySizedBox(
          alignment: Alignment.centerLeft,
          widthFactor: progress.clamp(0.0, 1.0),
          child: const DecoratedBox(
            decoration: BoxDecoration(
              color: Nocturne.accent,
              boxShadow: [BoxShadow(color: Nocturne.accent, blurRadius: 8)],
            ),
          ),
        ),
      ),
    ),
  );
}

/// Along a cover's bottom edge: a stripe sweeping while its preview loads.
class LoadingBar extends StatefulWidget {
  const LoadingBar({super.key});

  @override
  State<LoadingBar> createState() => _LoadingBarState();
}

class _LoadingBarState extends State<LoadingBar>
    with SingleTickerProviderStateMixin {
  late final _sweep = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  )..repeat();

  @override
  void dispose() {
    _sweep.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Positioned(
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    child: IgnorePointer(
      child: LayoutBuilder(
        builder: (context, constraints) {
          final width = constraints.maxWidth, stripe = width * 0.35;
          return AnimatedBuilder(
            animation: _sweep,
            builder: (context, _) {
              final t = Curves.easeInOutQuad.transform(_sweep.value);
              return Stack(
                children: [
                  Positioned(
                    left: -stripe + t * (width + stripe),
                    width: stripe,
                    top: 0,
                    bottom: 0,
                    child: const ColoredBox(color: Nocturne.accent),
                  ),
                ],
              );
            },
          );
        },
      ),
    ),
  );
}
