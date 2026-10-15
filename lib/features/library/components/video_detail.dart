import 'package:flutter/widgets.dart';

import '../../../api/cove_client.dart';
import '../../../data/library.dart';
import '../../../theme/tokens.dart';
import '../../../ui/button.dart';
import '../../../ui/icon_button.dart';
import '../../../ui/icons.dart';
import '../../../ui/misc.dart';
import '../../../ui/pressable.dart';
import '../../../ui/thumb.dart';
import '../../../utils/format.dart';
import '../../../ui/chips.dart';
import 'preview_clip.dart';
import '../../../api/http.dart';

/// The tablet Library's preview (design 1h, in a drawer): the video picked in the grid — its cover playing Cove's
/// preview clip, with the rating, the resume bar and a tick per moment; title and meta; Resume / Play, Save for later,
/// Favorite; the moments (Cove's segments); people and tags; the group.
class VideoDetail extends StatefulWidget {
  const VideoDetail({
    super.key,
    required this.client,
    required this.personal,
    required this.video,
    required this.onPlay,
    required this.onClose,
    this.onAddTag,
    this.onAddPerformer,
  });

  final CoveClient client;
  final PersonalStore personal;
  final Video video;
  // From a moment's start, or from where the user left off
  final void Function(Video video, {double? startAt}) onPlay;
  final VoidCallback onClose;

  /// A person or a tag tapped goes into the filter
  final ValueChanged<Named>? onAddTag;
  final ValueChanged<Named>? onAddPerformer;

  @override
  State<VideoDetail> createState() => _VideoDetailState();
}

class _VideoDetailState extends State<VideoDetail> {
  // The preview's state, for the video it was for (the loading bar runs until it plays)
  ({int id, PreviewState state})? _preview;

  @override
  Widget build(BuildContext context) {
    final video = widget.video;
    return ListenableBuilder(
      listenable: widget.personal,
      builder: (context, _) {
        final personal = widget.personal.of(video);
        final duration = video.primaryFile?.duration ?? 0;
        final progress = personal?.progress ?? 0;
        final left = (duration * (1 - progress) / 60).round();
        final rating = personal?.rating;
        final meta = videoMeta(video, personal?.playCount);
        final group = video.groups.firstOrNull;
        final loading =
            _preview?.id != video.id || _preview?.state == PreviewState.loading;
        return FutureBuilder(
          future: widget.personal.segments(video.id),
          builder: (context, snapshot) {
            final segments = snapshot.data ?? const <Segment>[];
            return ListView(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 28),
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'PREVIEW',
                        style: inter(
                          12,
                          color: Nocturne.textAlpha(50),
                          letterSpacing: 1,
                        ),
                      ),
                    ),
                    Transform.translate(
                      offset: const Offset(8, 0),
                      child: CloseIconButton(onPressed: widget.onClose),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Pressable(
                  onPressed: () => widget.onPlay(video),
                  semanticLabel: 'Play ${videoTitle(video)}',
                  builder: (context, states) => AspectRatio(
                    aspectRatio: 16 / 9,
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(Nocturne.radiusLg),
                      child: Stack(
                        fit: StackFit.expand,
                        children: [
                          const ColoredBox(color: Nocturne.bg),
                          Image(
                            image: coveImage(
                              widget.client.imageUrl(video),
                              widget.client.authHeaders,
                            ),
                            fit: BoxFit.cover,
                            gaplessPlayback: true,
                            errorBuilder: (_, _, _) => const SizedBox.shrink(),
                          ),
                          PreviewClip(
                            // Another video: another player, from its start
                            key: ValueKey(video.id),
                            client: widget.client,
                            videoId: video.id,
                            onState: (state) {
                              if (mounted) {
                                setState(
                                  () => _preview = (id: video.id, state: state),
                                );
                              }
                            },
                          ),
                          if (loading) const LoadingBar(),
                          if (rating != null && rating > 0)
                            RatingPill(stars(rating)),
                          Center(
                            child: Container(
                              width: 56,
                              height: 56,
                              alignment: Alignment.center,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: Color(
                                  states.highlighted ? 0xB30E0F18 : 0x800E0F18,
                                ),
                                border: Border.all(
                                  color: Nocturne.textAlpha(30),
                                ),
                              ),
                              child: Icon(
                                Phosphor.fill(Phosphor.play),
                                size: 22,
                                color: Nocturne.text,
                              ),
                            ),
                          ),
                          ThumbBadge(badgeText(video), large: true),
                          if (progress > 0) ResumeBar(progress, height: 3),
                          // A tick per moment along the bottom edge
                          if (duration > 0 && segments.isNotEmpty)
                            Positioned.fill(
                              child: IgnorePointer(
                                child: LayoutBuilder(
                                  builder: (context, box) => Stack(
                                    children: [
                                      for (final s in segments)
                                        Positioned(
                                          left:
                                              (s.startSec / duration).clamp(
                                                    0.0,
                                                    1.0,
                                                  ) *
                                                  box.maxWidth -
                                              1,
                                          bottom: 0,
                                          width: 2,
                                          height: 9,
                                          child: const DecoratedBox(
                                            decoration: BoxDecoration(
                                              color: Nocturne.accent300,
                                              borderRadius: BorderRadius.all(
                                                Radius.circular(1),
                                              ),
                                            ),
                                          ),
                                        ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                Text(
                  videoTitle(video),
                  style: inter(21, weight: medium, height: 27),
                ),
                if (meta.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      meta,
                      style: inter(12.5, color: Nocturne.textAlpha(55)),
                    ),
                  ),
                const SizedBox(height: 14),
                Row(
                  spacing: 8,
                  children: [
                    Expanded(
                      child: CoveButton(
                        label: progress > 0
                            ? 'Resume · $left min left'
                            : 'Play',
                        icon: Phosphor.fill(Phosphor.play),
                        onPressed: () => widget.onPlay(video),
                      ),
                    ),
                    MarkToggle(
                      kind: Mark.later,
                      square: true,
                      on: personal?.savedForLater ?? false,
                      onPressed: () =>
                          widget.personal.toggleSavedForLater(video),
                    ),
                    MarkToggle(
                      kind: Mark.favorite,
                      square: true,
                      on: personal?.favorite ?? false,
                      onPressed: () => widget.personal.toggleFavorite(video),
                    ),
                  ],
                ),
                if (segments.isNotEmpty) ...[
                  const SizedBox(height: 14),
                  const Rule(),
                  const SizedBox(height: 14),
                  const _Label('MOMENTS'),
                  const SizedBox(height: 8),
                  for (final s in segments)
                    _Moment(
                      client: widget.client,
                      videoId: video.id,
                      segment: s,
                      onPressed: () =>
                          widget.onPlay(video, startAt: s.startSec),
                    ),
                ],
                if (video.performers.isNotEmpty || video.tags.isNotEmpty) ...[
                  const SizedBox(height: 14),
                  const _Label('PEOPLE & TAGS'),
                  const SizedBox(height: 8),
                  Wrap(
                    runSpacing: 6,
                    children: [
                      for (final p in video.performers)
                        PersonChip(
                          p.name,
                          onPressed: widget.onAddPerformer == null
                              ? null
                              : () => widget.onAddPerformer!(p),
                        ),
                      for (final t in video.tags)
                        TagChip(
                          t.name,
                          onPressed: widget.onAddTag == null
                              ? null
                              : () => widget.onAddTag!(t),
                        ),
                    ],
                  ),
                ],
                if (group != null) ...[
                  const SizedBox(height: 14),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: GroupLine(group),
                  ),
                ],
              ],
            );
          },
        );
      },
    );
  }
}

class _Label extends StatelessWidget {
  const _Label(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Text(
    text,
    style: inter(11.5, color: Nocturne.textAlpha(50), letterSpacing: 0.9),
  );
}

/// A moment: a frame from its start, its name and when; a tap plays from there.
class _Moment extends StatelessWidget {
  const _Moment({
    required this.client,
    required this.videoId,
    required this.segment,
    required this.onPressed,
  });

  final CoveClient client;
  final int videoId;
  final Segment segment;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Pressable(
    onPressed: onPressed,
    semanticLabel: segment.label,
    builder: (context, states) => Container(
      padding: const EdgeInsets.all(5),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(Nocturne.radiusMd),
        color: states.highlighted || states.pressed
            ? Nocturne.textAlpha(6)
            : null,
      ),
      child: Row(
        spacing: 10,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: Image(
              image: coveImage(
                client.frameUrl(videoId, segment.startSec),
                client.authHeaders,
              ),
              width: 64,
              height: 36,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => const SizedBox(width: 64, height: 36),
            ),
          ),
          Expanded(
            child: Text(
              segment.label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: inter(13),
            ),
          ),
          Text(
            formatDuration(segment.startSec),
            style: inter(
              12,
              weight: medium,
              color: Nocturne.accent300,
            ).copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
          ),
        ],
      ),
    ),
  );
}
