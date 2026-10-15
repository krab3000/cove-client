import 'dart:async';

import 'package:flutter/widgets.dart';

import '../../../api/cove_client.dart';
import '../../../data/library.dart';
import '../../../state/prefs.dart';
import '../../../theme/tokens.dart';
import '../../../ui/icons.dart';
import '../../../ui/pressable.dart';
import '../../../ui/thumb.dart';
import '../../../utils/format.dart';
import '../../../ui/chips.dart';
import 'preview_clip.dart';

// A hover this long starts the card's preview (a pointer passing over the grid starts none)
const _hoverDelay = Duration(milliseconds: 250);

/// A Library card, in all three views: a grid tile (design 1f) or a list card (1g). Its cover is Cove's (or the
/// codec's name until there is one); hovered, it plays the video's preview clip. Without its video yet (its page is
/// loading) it is a skeleton.
class LibraryCard extends StatefulWidget {
  const LibraryCard({
    super.key,
    required this.client,
    required this.personal,
    required this.video,
    required this.view,
    required this.width,
    required this.selected,
    required this.onPressed,
    this.previews = true,
    this.focused = false,
    this.onAddTag,
    this.onAddPerformer,
    this.coverWidths = const [],
    this.decodeCover = true,
    this.still = false,
  });

  final CoveClient client;
  final PersonalStore personal;
  final Video? video;
  final LibraryView view;
  final double width;
  // The video in the preview drawer: an accent ring, its title in accent
  final bool selected;
  final ValueChanged<Video> onPressed;

  /// Previews may play (not under the player, not turned off in Settings)
  final bool previews;

  /// Touch: the card in the middle of the screen previews
  final bool focused;

  /// A tag or a person tapped on a list card goes into the filter
  final ValueChanged<Named>? onAddTag;
  final ValueChanged<Named>? onAddPerformer;

  /// The sizes (pixels wide) its cover is decoded at in the other views: one of them already decoded shows while
  /// this view's loads, so switching views shows no blank covers
  final List<int> coverWidths;

  /// False while cards move between views: a cover keeps a size already decoded (any of [coverWidths]) and its own
  /// size is decoded once the move is over (a cover never seen loads at once)
  final bool decodeCover;

  /// A card moving between views: drawn only (no gestures, hover or listeners)
  final bool still;

  @override
  State<LibraryCard> createState() => _LibraryCardState();
}

class _LibraryCardState extends State<LibraryCard> {
  bool _hovered = false;
  bool _hoverPreview = false;
  // Touch: pressed and held
  bool _held = false;

  bool get _previewing =>
      widget.previews && (_hoverPreview || _held || widget.focused);
  PreviewState _preview = PreviewState.loading;
  Timer? _hoverTimer;

  bool get _list => widget.view == LibraryView.list;

  @override
  void didUpdateWidget(LibraryCard old) {
    super.didUpdateWidget(old);
    // Another video in this card (the grid reuses cards as it scrolls): its preview starts over
    if (old.video?.id != widget.video?.id) _leave();
  }

  @override
  void dispose() {
    _hoverTimer?.cancel();
    super.dispose();
  }

  void _enter() {
    setState(() => _hovered = true);
    _hoverTimer?.cancel();
    _hoverTimer = Timer(_hoverDelay, () {
      if (mounted) {
        setState(() {
          _hoverPreview = true;
          _preview = PreviewState.loading;
        });
      }
    });
  }

  void _leave() {
    _hoverTimer?.cancel();
    if (_hovered || _hoverPreview || _held) {
      setState(() {
        _hovered = false;
        _hoverPreview = false;
        _held = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final video = widget.video;
    final radius = _list ? 14.0 : 6.0;
    final ring = !_list && (_hovered || widget.selected);
    final ringWidth = widget.selected ? 2.0 : 1.0;
    final thumbHeight = (widget.width * 9 / 16).roundToDouble();

    final cover = video == null ? null : _cover(video, thumbHeight);
    // One rounded clip per card: the cover and what is over it (a clip each made the GPU's frames late on a tablet)
    Widget thumb([List<Widget> overlays = const []]) => Container(
      height: thumbHeight,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: Nocturne.surface,
        borderRadius: BorderRadius.circular(radius),
        // The picked video's glow, under its cover
        boxShadow: widget.selected && !_list
            ? [BoxShadow(color: Nocturne.accentAlpha(35), blurRadius: 14)]
            : null,
      ),
      foregroundDecoration: ring
          ? BoxDecoration(
              borderRadius: BorderRadius.circular(radius),
              border: Border.all(color: Nocturne.accent, width: ringWidth),
            )
          : null,
      child: cover == null
          ? null
          : Stack(fit: StackFit.expand, children: [cover, ...overlays]),
    );

    if (video == null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          thumb(),
          const SizedBox(height: 8),
          FractionallySizedBox(
            widthFactor: 0.7,
            child: Container(
              height: 10,
              decoration: BoxDecoration(
                color: Nocturne.surface,
                borderRadius: BorderRadius.circular(4),
              ),
            ),
          ),
        ],
      );
    }

    Widget face(Personal? personal) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        thumb(_overlays(video, personal)),
        if (_list)
          _ListDetails(
            video: video,
            personal: personal,
            store: widget.personal,
            onAddTag: widget.onAddTag,
            onAddPerformer: widget.onAddPerformer,
          )
        else ...[
          const SizedBox(height: 5),
          Text(
            videoTitle(video),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: inter(
              12,
              weight: medium,
              height: 16,
              color: widget.selected ? Nocturne.accent300 : Nocturne.text,
            ),
          ),
          if (widget.view == LibraryView.grid2)
            Padding(
              padding: const EdgeInsets.only(top: 1),
              child: Text(
                videoSubtitle(video),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: inter(11.5, height: 15, color: Nocturne.textAlpha(55)),
              ),
            ),
        ],
      ],
    );

    // Moving between views: the card as a picture (no taps, hover or live data for the move's 450 ms)
    if (widget.still) return face(widget.personal.of(video));
    return GestureDetector(
      onLongPressStart: (_) => setState(() {
        _held = true;
        _preview = PreviewState.loading;
      }),
      onLongPressEnd: (_) => setState(() => _held = false),
      child: MouseRegion(
        onEnter: (_) => _enter(),
        onExit: (_) => _leave(),
        child: Pressable(
          onPressed: () => widget.onPressed(video),
          semanticLabel: videoTitle(video),
          builder: (context, states) => ListenableBuilder(
            listenable: widget.personal,
            builder: (context, _) => face(widget.personal.of(video)),
          ),
        ),
      ),
    );
  }

  Widget _cover(Video video, double height) {
    final dpr = MediaQuery.devicePixelRatioOf(context);
    return _Cover(
      url: widget.client.imageUrl(video),
      headers: widget.client.authHeaders,
      height: height,
      // Decoded at the card's size: Cove serves generated covers at the video's resolution
      width: widget.width > 0 ? (widget.width * dpr).round() : null,
      others: widget.coverWidths,
      decode: widget.decodeCover,
      placeholder: (video.primaryFile?.videoCodec ?? '').toUpperCase(),
    );
  }

  List<Widget> _overlays(Video video, Personal? personal) {
    final progress = personal?.progress ?? 0;
    return [
      if (_previewing)
        Positioned.fill(
          child: PreviewClip(
            key: ValueKey(video.id),
            client: widget.client,
            videoId: video.id,
            onState: (state) {
              if (mounted) setState(() => _preview = state);
            },
          ),
        ),
      if (_previewing && _preview == PreviewState.loading) const LoadingBar(),
      if (_list) ...[
        if (personal?.rating case final rating? when rating > 0)
          RatingPill(stars(rating)),
        ThumbBadge(badgeText(video), large: true),
        if (progress > 0) ResumeBar(progress, height: 3),
      ] else ...[
        if (personal?.favorite ?? false)
          Positioned(
            right: 4,
            top: 4,
            child: Container(
              width: 18,
              height: 18,
              alignment: Alignment.center,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: Color(0x990A0B12),
              ),
              child: Icon(
                Phosphor.fill(Phosphor.heart),
                size: 10,
                color: Nocturne.accent300,
              ),
            ),
          ),
        ThumbBadge(badgeText(video)),
        if (progress > 0) ResumeBar(progress),
      ],
    ];
  }
}

/// A list card under its cover, to decide without opening the video: title; studio, date and play count; Save for
/// later and Favorite; the group, people and tags.
class _ListDetails extends StatelessWidget {
  const _ListDetails({
    required this.video,
    required this.personal,
    required this.store,
    this.onAddTag,
    this.onAddPerformer,
  });

  final Video video;
  final Personal? personal;
  final PersonalStore store;
  final ValueChanged<Named>? onAddTag;
  final ValueChanged<Named>? onAddPerformer;

  @override
  Widget build(BuildContext context) {
    final group = video.groups.firstOrNull;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 10),
        SizedBox(
          height: 44,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      videoTitle(video),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: inter(17, weight: medium, height: 22),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      videoMeta(video, personal?.playCount),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: inter(
                        12.5,
                        height: 16,
                        color: Nocturne.textAlpha(55),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              MarkToggle(
                kind: Mark.later,
                on: personal?.savedForLater ?? false,
                onPressed: () => store.toggleSavedForLater(video),
              ),
              const SizedBox(width: 4),
              MarkToggle(
                kind: Mark.favorite,
                on: personal?.favorite ?? false,
                onPressed: () => store.toggleFavorite(video),
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        SizedBox(
          height: 28,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: [
              if (group != null) GroupLine(group),
              for (final p in video.performers)
                PersonChip(
                  p.name,
                  onPressed: onAddPerformer == null
                      ? null
                      : () => onAddPerformer!(p),
                ),
              for (final t in video.tags)
                TagChip(
                  t.name,
                  onPressed: onAddTag == null ? null : () => onAddTag!(t),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

/// The covers decoded so far, as "url@width" (a view switch shows one of these while its own size loads).
final _decoded = <String>{};

/// A card's cover, decoded at the card's size. Until that size has loaded, a size of it already decoded for another
/// view shows (scaled), so a view switch never shows the cover blank; a cover loading for the first time fades in.
class _Cover extends StatelessWidget {
  const _Cover({
    required this.url,
    required this.headers,
    required this.height,
    required this.width,
    required this.others,
    required this.placeholder,
    this.decode = true,
  });

  final String url;
  final Map<String, String> headers;
  final double height;
  final int? width;
  final List<int> others;
  final String placeholder;
  final bool decode;

  @override
  Widget build(BuildContext context) {
    final w = width;
    final ready = w != null && _decoded.contains('$url@$w');
    final fallback = ready
        ? null
        : others
              .where((o) => o != w && _decoded.contains('$url@$o'))
              .firstOrNull;
    Image image(int? decodeWidth, {required bool own}) => Image.network(
      url,
      headers: headers,
      fit: BoxFit.cover,
      width: double.infinity,
      height: height,
      cacheWidth: decodeWidth,
      gaplessPlayback: true,
      frameBuilder: (context, child, frame, sync) {
        if (frame != null && decodeWidth != null)
          _decoded.add('$url@$decodeWidth');
        // Its own size over a fallback: shown once loaded, at once (the fallback is the same picture)
        if (sync || ready) return child;
        if (fallback != null && own)
          return Opacity(opacity: frame == null ? 0 : 1, child: child);
        return AnimatedOpacity(
          opacity: frame == null ? 0 : 1,
          duration: const Duration(milliseconds: 180),
          child: child,
        );
      },
      errorBuilder: (context, error, stack) => own
          ? Center(
              child: Text(
                placeholder,
                style: inter(
                  14,
                  weight: FontWeight.w600,
                  color: Nocturne.textAlpha(55),
                ),
              ),
            )
          : const SizedBox.shrink(),
    );
    // Not now (a move): the size already decoded alone
    if (!decode && fallback != null) return image(fallback, own: false);
    final own = image(w, own: true);
    if (fallback == null) return own;
    return Stack(
      fit: StackFit.expand,
      children: [image(fallback, own: false), own],
    );
  }
}
