import 'dart:math';

import 'package:collection/collection.dart';

import 'package:flutter/material.dart' show RefreshIndicator;
import 'package:flutter/widgets.dart';

import '../../../api/cove_client.dart';
import '../../../data/library.dart';
import '../../../state/prefs.dart';
import '../../../theme/layout.dart';
import '../../../theme/tokens.dart';
import '../../../ui/button.dart';
import '../../../ui/misc.dart';
import 'library_card.dart';

// The three views (design 1f/1g): a wider window fits more columns, none narrower than `target`. The list is a feed:
// one card in a row, at most _listMaxWidth wide (wider, a card would be taller than the screen), centred; a phone held
// sideways shows two list cards in a row (6h).
const _specs = {
  LibraryView.grid2: (
    min: 2,
    target: 300.0,
    padX: 16.0,
    gapX: 12.0,
    gapY: 16.0,
  ),
  LibraryView.grid3: (min: 3, target: 190.0, padX: 16.0, gapX: 8.0, gapY: 12.0),
  LibraryView.list: (min: 1, target: 520.0, padX: 20.0, gapX: 20.0, gapY: 28.0),
};
const _listMaxWidth = 960.0;
const _padTop = 10.0;

// Switching views: the cards on screen move to their places in the new view this
// long; a card new to the screen comes in where it lands, from transparent, this much smaller and this much lower,
// the further down the screen the later (up to this share of the move).
const _moveDuration = Duration(milliseconds: 450);
const _enterScale = 0.85;
const _enterRise = 24.0;
const _enterStagger = 0.4;

/// Where everything is in a view at a width: rows of a fixed height, so a card's box follows from its index.
class _Geometry {
  _Geometry(this.view, double width, bool sideways) {
    final spec = _specs[view]!;
    final list = view == LibraryView.list;
    columns = list
        ? (sideways ? 2 : 1)
        : max(
            spec.min,
            ((width - 2 * spec.padX + spec.gapX) / (spec.target + spec.gapX))
                .floor(),
          );
    cardWidth = max(
      0,
      list
          ? min(
              _listMaxWidth,
              (width - 2 * spec.padX - spec.gapX * (columns - 1)) / columns,
            ).floorToDouble()
          : ((width - 2 * spec.padX - spec.gapX * (columns - 1)) / columns)
                .floorToDouble(),
    );
    padX = list
        ? ((width - cardWidth * columns - spec.gapX * (columns - 1)) / 2)
              .floorToDouble()
        : spec.padX;
    gapX = spec.gapX;
    gapY = spec.gapY;
    final thumb = (cardWidth * 9 / 16).roundToDouble();
    cardHeight = list
        ? thumb + 10 + 44 + 10 + 28
        : thumb + 5 + 16 + (view == LibraryView.grid2 ? 16 : 0);
  }

  final LibraryView view;
  late final int columns;
  late final double cardWidth;
  late final double cardHeight;
  late final double padX;
  late final double gapX;
  late final double gapY;

  double get rowHeight => cardHeight + gapY;

  /// A card's box in the list's content (scroll offset 0).
  Rect rectOf(int index) => Rect.fromLTWH(
    padX + (index % columns) * (cardWidth + gapX),
    _padTop + (index ~/ columns) * rowHeight,
    cardWidth,
    cardHeight,
  );

  /// The indices whose rows show in [top, top + height).
  Iterable<int> visible(double top, double height, int total) sync* {
    final first = max(0, ((top - _padTop) / rowHeight).floor());
    final last = ((top + height - _padTop) / rowHeight).floor();
    for (var row = first; row <= last; row++) {
      for (var c = 0; c < columns; c++) {
        final i = row * columns + c;
        if (i >= total) return;
        yield i;
      }
    }
  }

  double contentHeight(int total, double bottom) =>
      _padTop + ((total + columns - 1) ~/ columns) * rowHeight - gapY + bottom;
}

/// A card during a view switch: from where it was (null: new to the screen) to where it goes, in the viewport.
typedef _Mover = ({int index, Rect? from, Rect to});

/// The Library's videos in one of its views: rows of a fixed height, so the grid is virtual (only the rows in view are
/// built) and each card asks for its page as it comes into view. Switching views moves the cards on screen to their new
/// places (the top one stays where it is). On a touch screen every card of the list on screen plays its preview (the
/// grids' on a long press), and a pull from the top refreshes.
class LibraryGrid extends StatefulWidget {
  const LibraryGrid({
    super.key,
    required this.library,
    required this.personal,
    required this.view,
    required this.selectedId,
    required this.onPressed,
    required this.onBackground,
    required this.previews,
    required this.onAddTag,
    required this.onAddPerformer,
    this.sideways = false,
  });

  final Library library;
  final PersonalStore personal;
  final LibraryView view;
  final int? selectedId;
  final ValueChanged<Video> onPressed;
  // A tap beside the cards (closes the preview drawer)
  final VoidCallback onBackground;
  final bool previews;
  final ValueChanged<Named> onAddTag;
  final ValueChanged<Named> onAddPerformer;
  final bool sideways;

  @override
  State<LibraryGrid> createState() => _LibraryGridState();
}

class _LibraryGridState extends State<LibraryGrid>
    with SingleTickerProviderStateMixin {
  final _scroll = ScrollController();
  // Touch, list view: the cards on screen
  Set<int> _focused = const {};
  _Geometry? _geometry;
  double _width = 0;
  double _viewport = 0;
  double _bottom = 0;

  late final _move = AnimationController(vsync: this, duration: _moveDuration)
    ..addStatusListener((status) {
      if (status != AnimationStatus.completed || !mounted) return;
      // The cards are in place: the list becomes the new view under them, scrolls to where they are, then shows
      setState(() {
        _gridView = null;
        _gridSideways = null;
      });
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        if (_scroll.hasClients)
          _scroll.jumpTo(_next.clamp(0.0, _scroll.position.maxScrollExtent));
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            setState(() {
              _movers = null;
              _moverCards.clear();
            });
          }
        });
      });
    });
  late final _moveCurve = CurvedAnimation(
    parent: _move,
    curve: Curves.easeOutCubic,
  );
  List<_Mover>? _movers;
  // The view the list underneath shows: the old one during a move (it is rebuilt for the new view once the cards are
  // in place, under the still overlay, so that build never stalls a moving frame)
  LibraryView? _gridView;
  bool? _gridSideways;
  // Where the list scrolls to for the new view
  double _next = 0;
  _Geometry? _target;
  final _snapshots = SnapshotController(allowSnapshotting: true);
  // The cards of the move, built once at its start
  final _moverCards = <int, Widget>{};

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_updateFocus);
  }

  @override
  void didUpdateWidget(LibraryGrid old) {
    super.didUpdateWidget(old);
    // Another list (filter, search, order): from its top
    if (old.library.generation != widget.library.generation &&
        _scroll.hasClients) {
      _move.stop();
      _movers = null;
      _scroll.jumpTo(0);
    } else if (old.view != widget.view || old.sideways != widget.sideways) {
      _startMove(old);
    }
  }

  @override
  void dispose() {
    _snapshots.dispose();
    _moveCurve.dispose();
    _move.dispose();
    _scroll.dispose();
    super.dispose();
  }

  /// Another view: where each card on screen goes, keeping the top one in place; the scroll follows it.
  void _startMove(LibraryGrid old) {
    // Mid-move: from where the cards were heading (the list underneath still shows the view before that)
    final midMove = _movers != null;
    final from = midMove ? _target : _geometry, total = widget.library.total;
    if (from == null ||
        total == null ||
        total == 0 ||
        !_scroll.hasClients ||
        _width <= 0)
      return;
    final to = _Geometry(widget.view, _width, widget.sideways);
    final offset = midMove ? _next : _scroll.offset;
    // The card at the top of the screen keeps its place on screen (as far as the list's ends allow)
    final anchor = from.visible(offset, 1, total).firstOrNull ?? 0;
    final shift = from.rectOf(anchor).top - offset;
    final maxOffset = max(0.0, to.contentHeight(total, _bottom) - _viewport);
    final next = (to.rectOf(anchor).top - shift).clamp(0.0, maxOffset);
    final before = from.visible(offset, _viewport, total).toSet();
    final after = to.visible(next, _viewport, total).toSet();
    _moverCards.clear();
    _target = to;
    _movers = [
      for (final i in {...before, ...after})
        (
          index: i,
          from: before.contains(i)
              ? from.rectOf(i).translate(0, -offset)
              : null,
          to: to.rectOf(i).translate(0, -next),
        ),
    ];
    _next = next;
    if (!midMove) {
      _gridView = from.view;
      _gridSideways = old.sideways;
    }
    _move.forward(from: 0);
  }

  /// Touch, list view: the cards on screen.
  void _updateFocus() {
    final g = _geometry;
    if (desktop ||
        widget.view != LibraryView.list ||
        !_scroll.hasClients ||
        g == null) {
      if (_focused.isNotEmpty) setState(() => _focused = const {});
      return;
    }
    final on = g
        .visible(_scroll.offset, _viewport, widget.library.total ?? 0)
        .toSet();
    if (!const SetEquality<int>().equals(on, _focused)) {
      setState(() => _focused = on);
    }
  }

  @override
  Widget build(BuildContext context) {
    final library = widget.library;
    final total = library.total;
    if (total == null) {
      return library.error.isNotEmpty
          ? _Message(
              title: "Couldn't load the videos",
              text: library.error,
              action: CoveButton(label: 'Try again', onPressed: library.retry),
            )
          : const Center(child: Spinner());
    }
    if (total == 0) {
      return const _Message(
        title: 'No videos',
        text: 'Nothing matches what is shown. Try another filter or search.',
      );
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        // Laid out narrower than its own padding for a moment (a window or a drawer settling): nothing to show yet
        if (width < 2 * _specs[widget.view]!.padX + 40)
          return const SizedBox.shrink();
        final g = _Geometry(
          _gridView ?? widget.view,
          width,
          _gridSideways ?? widget.sideways,
        );
        _geometry = g;
        _width = width;
        _viewport = constraints.maxHeight;
        _bottom = 28 + MediaQuery.paddingOf(context).bottom;
        // In the list, and once more after leaving it (its cards stop)
        if (!desktop &&
            (widget.view == LibraryView.list || _focused.isNotEmpty)) {
          WidgetsBinding.instance.addPostFrameCallback((_) => _updateFocus());
        }
        // A cover is decoded at its card's size in each view: these, so a card can show a size already decoded
        // while its own loads (a view switch shows no blank covers)
        final dpr = MediaQuery.devicePixelRatioOf(context);
        final coverWidths = [
          for (final v in LibraryView.values)
            (_Geometry(v, width, widget.sideways).cardWidth * dpr).round(),
        ];
        LibraryCard card(
          int index, {
          bool previews = true,
          bool decode = true,
          bool still = false,
          _Geometry? at,
        }) {
          final video = library.videoAt(index);
          return LibraryCard(
            client: library.client,
            personal: widget.personal,
            video: video,
            view: (at ?? g).view,
            width: (at ?? g).cardWidth,
            selected: video != null && video.id == widget.selectedId,
            onPressed: widget.onPressed,
            previews: previews && widget.previews,
            focused: _focused.contains(index),
            onAddTag: widget.onAddTag,
            onAddPerformer: widget.onAddPerformer,
            coverWidths: coverWidths,
            decodeCover: decode,
            still: still,
          );
        }

        Widget grid = GridView.builder(
          key: ValueKey('grid-${library.generation}'),
          controller: _scroll,
          physics: const AlwaysScrollableScrollPhysics(),
          padding: EdgeInsets.fromLTRB(g.padX, _padTop, g.padX, _bottom),
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: g.columns,
            mainAxisSpacing: g.gapY,
            crossAxisSpacing: g.gapX,
            mainAxisExtent: g.cardHeight,
          ),
          itemCount: total,
          itemBuilder: (context, index) => card(index),
        );
        // Where in the list, and how much is left: always shown (rows have a fixed height, so it is exact); drag it to
        // jump through the list
        grid = RawScrollbar(
          controller: _scroll,
          thumbVisibility: true,
          interactive: true,
          thickness: desktop ? 6 : 5,
          minThumbLength: 48,
          radius: const Radius.circular(3),
          crossAxisMargin: 3,
          mainAxisMargin: 6,
          thumbColor: Nocturne.textAlpha(35),
          child: ScrollConfiguration(
            // One scrollbar (ours), not the platform's too
            behavior: ScrollConfiguration.of(context)
                .copyWith(scrollbars: false),
            child: grid,
          ),
        );
        if (!desktop) {
          grid = RefreshIndicator(
            color: Nocturne.accent,
            backgroundColor: Nocturne.surface,
            onRefresh: () async {
              widget.personal.clear();
              library.refresh();
            },
            child: grid,
          );
        }
        grid = GestureDetector(
          behavior: HitTestBehavior.translucent,
          onTap: widget.onBackground,
          child: grid,
        );
        final movers = _movers;
        // The move: the new view's cards, each drawn once at its new size and carried from its old place by a
        // transform (no layout per frame); the list under it is already the new view's, hidden until the move ends.
        // The list stays in the same place in the tree with or without a move (moved, its scroll would start over).
        return Stack(
          children: [
            Positioned.fill(
              child: IgnorePointer(
                ignoring: movers != null,
                child: Opacity(opacity: movers == null ? 1 : 0, child: grid),
              ),
            ),
            if (movers != null)
              Positioned.fill(
                child: ClipRect(
                  child: AnimatedBuilder(
                    animation: _moveCurve,
                    builder: (context, _) => Stack(
                      children: [
                        for (final m in movers)
                          _moved(
                            m,
                            // Built once, at the new size, drawn only; covers keep a size already decoded (decoding new
                            // sizes during the move made its frames late)
                            _moverCards[m.index] ??= card(
                              m.index,
                              previews: false,
                              decode: false,
                              still: true,
                              at: _target,
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }

  Widget _moved(_Mover m, Widget child) {
    final t = _moveCurve.value;
    final to = m.to;
    final from = m.from;
    final Matrix4 transform;
    var opacity = 1.0;
    if (from != null) {
      // From its old box: moved and scaled (the old box's width over the new one's), easing into place
      final scale = _lerp(from.width / to.width, 1, t);
      transform = Matrix4.identity()
        ..translateByDouble(
          _lerp(from.left - to.left, 0, t),
          _lerp(from.top - to.top, 0, t),
          0,
          1,
        )
        ..scaleByDouble(scale, scale, 1, 1);
    } else {
      // New to the screen: comes in where it lands, the lower the later
      final delay =
          _enterStagger * (to.top / max(1, _viewport)).clamp(0.0, 1.0);
      final local = Curves.easeOutCubic.transform(
        ((_move.value - delay) / (1 - delay)).clamp(0.0, 1.0),
      );
      opacity = local;
      final scale = _lerp(_enterScale, 1, local);
      transform = Matrix4.identity()
        ..translateByDouble(
          to.width * (1 - scale) / 2,
          _lerp(_enterRise, 0, local) + to.height * (1 - scale) / 2,
          0,
          1,
        )
        ..scaleByDouble(scale, scale, 1, 1);
    }
    return Positioned(
      key: ValueKey(m.index),
      left: to.left,
      top: to.top,
      width: to.width,
      height: to.height,
      child: Opacity(
        opacity: opacity,
        child: Transform(
          transform: transform,
          // Drawn once into an image, which the move only moves: drawing each card anew (its rounded clip, text,
          // badges, cover) every frame was more than a tablet's GPU managed at 60 fps
          child: SnapshotWidget(controller: _snapshots, child: child),
        ),
      ),
    );
  }
}

double _lerp(double a, double b, double t) => a + (b - a) * t;

class _Message extends StatelessWidget {
  const _Message({required this.title, required this.text, this.action});

  final String title;
  final String text;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(48),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        spacing: 10,
        children: [
          Text(title, style: inter(20, weight: medium)),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Text(
              text,
              textAlign: TextAlign.center,
              style: inter(14, color: Nocturne.textAlpha(60), height: 21),
            ),
          ),
          ?action,
        ],
      ),
    ),
  );
}
