import 'dart:async';

import 'package:flutter/widgets.dart';

import '../../../api/models.dart';
import '../../../theme/tokens.dart';
import '../../../utils/format.dart';
import '../../../api/http.dart';

const _ink = Color(0xFFE9E9ED);
const _marker = Color(0xFFD2CEFD);

/// The seek bar (design 1k / 1l / 1m): the played part with the accent's glow, the buffered part, a tick per moment and
/// a thumb; dragged, a bubble above it shows the frame there (a sprite-sheet cell, else Cove's screenshot once the
/// finger rests) with the time and the moment. [big] is the sideways and tablet track (5 px, 20 px thumb).
class SeekTrack extends StatefulWidget {
  const SeekTrack({
    super.key,
    required this.position,
    required this.duration,
    required this.buffered,
    required this.markers,
    required this.onSeek,
    required this.thumbVisible,
    this.big = false,
    this.sprite,
    this.clipStart = 0,
    this.frameUrl,
    this.frameHeaders,
    this.momentLabel,
    this.onScrubbing,
  });

  final double position;
  final double duration;
  final double buffered;

  /// Moment starts, as fractions of the duration
  final List<double> markers;
  final ValueChanged<double> onSeek;
  final bool thumbVisible;
  final bool big;
  final SpriteSheet? sprite;
  final double clipStart;

  /// A frame at a time in the file (no sprite sheet)
  final String Function(double seconds)? frameUrl;
  final Map<String, String>? frameHeaders;

  /// The moment at a time in the clip, for the bubble's label
  final String? Function(double seconds)? momentLabel;
  final ValueChanged<bool>? onScrubbing;

  @override
  State<SeekTrack> createState() => _SeekTrackState();
}

class _SeekTrackState extends State<SeekTrack> {
  double? _scrub; // 0–1 while dragging
  double? _rested; // the time a drag rested at (for a screenshot frame)
  Timer? _rest;

  @override
  void dispose() {
    _rest?.cancel();
    super.dispose();
  }

  void _drag(double dx, double width) {
    final f = (dx / width).clamp(0.0, 1.0);
    if (_scrub == null) widget.onScrubbing?.call(true);
    setState(() {
      _scrub = f;
      _rested = null;
    });
    _rest?.cancel();
    _rest = Timer(const Duration(milliseconds: 150), () {
      if (mounted && _scrub != null)
        setState(() => _rested = _scrub! * widget.duration);
    });
  }

  void _commit() {
    final f = _scrub;
    if (f != null) widget.onSeek(f * widget.duration);
    _rest?.cancel();
    setState(() => _scrub = _rested = null);
    widget.onScrubbing?.call(false);
  }

  @override
  Widget build(BuildContext context) {
    final big = widget.big;
    final track = big ? 5.0 : 3.0;
    final thumb = big ? 20.0 : 13.0;
    final tick = big ? const Size(3, 11) : const Size(2, 9);
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final d = widget.duration;
        final played =
            _scrub ?? (d > 0 ? (widget.position / d).clamp(0.0, 1.0) : 0.0);
        final buffered = d > 0 ? (widget.buffered / d).clamp(0.0, 1.0) : 0.0;
        return GestureDetector(
          behavior: HitTestBehavior.opaque,
          onHorizontalDragStart: (e) => _drag(e.localPosition.dx, width),
          onHorizontalDragUpdate: (e) => _drag(e.localPosition.dx, width),
          onHorizontalDragEnd: (_) => _commit(),
          onHorizontalDragCancel: () {
            setState(() => _scrub = _rested = null);
            widget.onScrubbing?.call(false);
          },
          onTapDown: (e) => _drag(e.localPosition.dx, width),
          onTapUp: (_) => _commit(),
          child: SizedBox(
            height: 32,
            child: Stack(
              clipBehavior: Clip.none,
              alignment: Alignment.centerLeft,
              children: [
                // The track, the buffered part, the played part
                Positioned(
                  left: 0,
                  right: 0,
                  height: track,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: _ink.withValues(alpha: 0.22),
                      borderRadius: BorderRadius.circular(track),
                    ),
                  ),
                ),
                Positioned(
                  left: 0,
                  width: width * buffered,
                  height: track,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: _ink.withValues(alpha: 0.32),
                      borderRadius: BorderRadius.circular(track),
                    ),
                  ),
                ),
                Positioned(
                  left: 0,
                  width: width * played,
                  height: track,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: Nocturne.accent,
                      borderRadius: BorderRadius.circular(track),
                      boxShadow: const [
                        BoxShadow(color: Nocturne.accent, blurRadius: 8),
                      ],
                    ),
                  ),
                ),
                for (final m in widget.markers)
                  Positioned(
                    left: width * m - tick.width / 2,
                    top: 16 - track / 2 - 3,
                    width: tick.width,
                    height: tick.height,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: _marker,
                        borderRadius: BorderRadius.circular(1),
                      ),
                    ),
                  ),
                if (widget.thumbVisible || _scrub != null)
                  Positioned(
                    left: width * played - thumb / 2,
                    width: thumb,
                    height: thumb,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: Nocturne.accent200,
                        boxShadow: [
                          BoxShadow(
                            color: Nocturne.accentAlpha(35),
                            spreadRadius: big ? 5 : 3,
                          ),
                          const BoxShadow(
                            color: Nocturne.accent,
                            blurRadius: 10,
                          ),
                        ],
                      ),
                    ),
                  ),
                if (_scrub != null && d > 0) _bubble(width, _scrub!),
              ],
            ),
          ),
        );
      },
    );
  }

  /// The frame where the drag is, 176×99, over the track (kept inside it).
  Widget _bubble(double width, double f) {
    const w = 176.0, h = 99.0;
    final seconds = f * widget.duration;
    final left = (width * f - w / 2).clamp(
      0.0,
      (width - w).clamp(0.0, double.infinity),
    );
    final label = widget.momentLabel?.call(seconds);
    final sprite = widget.sprite;
    Widget? frame;
    if (sprite != null && sprite.cues.isNotEmpty) {
      final t = widget.clipStart + seconds;
      final cue =
          sprite.cues.where((c) => t >= c.start && t < c.end).firstOrNull ??
          sprite.cues.last;
      frame = SpriteCell(
        sheet: sprite,
        cue: cue,
        width: w,
        height: h,
        headers: widget.frameHeaders,
      );
    } else if (_rested != null && widget.frameUrl != null) {
      frame = Image(
        image: coveImage(
          widget.frameUrl!(widget.clipStart + _rested!),
          widget.frameHeaders,
        ),
        fit: BoxFit.cover,
        gaplessPlayback: true,
        errorBuilder: (_, _, _) => const SizedBox.shrink(),
      );
    }
    return Positioned(
      left: left,
      bottom: 26,
      width: w,
      child: IgnorePointer(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: w,
              height: h,
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(
                color: const Color(0xFF0A0B12),
                borderRadius: BorderRadius.circular(Nocturne.radiusMd),
                border: Border.all(color: Nocturne.accent, width: 1.5),
                boxShadow: [
                  BoxShadow(color: Nocturne.accentAlpha(40), blurRadius: 16),
                ],
              ),
              child: frame,
            ),
            const SizedBox(height: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: const Color(0xBF0E0F18),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                [formatDuration(seconds), ?label].join(' · '),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: inter(
                  12,
                  weight: medium,
                  color: _ink,
                ).copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A cell of Cove's sprite sheet, covering its box: the sheet scaled and moved so the cell fills it.
class SpriteCell extends StatelessWidget {
  const SpriteCell({
    super.key,
    required this.sheet,
    required this.cue,
    required this.width,
    required this.height,
    this.headers,
  });

  final SpriteSheet sheet;
  final SpriteCue cue;
  final double width;
  final double height;
  final Map<String, String>? headers;

  @override
  Widget build(BuildContext context) {
    final scale = (width / cue.w) > (height / cue.h)
        ? width / cue.w
        : height / cue.h;
    return ClipRect(
      child: SizedBox(
        width: width,
        height: height,
        child: Stack(
          clipBehavior: Clip.hardEdge,
          children: [
            Positioned(
              left: -cue.x * scale - (cue.w * scale - width) / 2,
              top: -cue.y * scale - (cue.h * scale - height) / 2,
              width: sheet.width * scale,
              height: sheet.height * scale,
              child: Image(
                image: coveImage(sheet.url, headers),
                fit: BoxFit.fill,
                gaplessPlayback: true,
                errorBuilder: (_, _, _) => const SizedBox.shrink(),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
