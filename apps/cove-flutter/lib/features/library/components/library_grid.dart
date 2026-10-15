import 'dart:math';

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

/// The Library's videos in one of its views: rows of a fixed height, so the grid is virtual (only the rows in view are
/// built) and each card asks for its page as it comes into view. On a touch screen the list's card in the middle of
/// the screen plays its preview, and a pull from the top refreshes.
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

class _LibraryGridState extends State<LibraryGrid> {
  final _scroll = ScrollController();
  int? _focused;
  double _rowHeight = 1;
  int _columns = 1;
  double _viewport = 0;

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
        _scroll.hasClients)
      _scroll.jumpTo(0);
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  /// Touch, list view: the card whose middle is nearest the screen's middle.
  void _updateFocus() {
    if (desktop || widget.view != LibraryView.list || !_scroll.hasClients) {
      if (_focused != null) setState(() => _focused = null);
      return;
    }
    final row = ((_scroll.offset + _viewport / 2 - 10) / _rowHeight).floor();
    final index = row * _columns;
    if (index != _focused) setState(() => _focused = index);
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
        final view = widget.view;
        final spec = _specs[view]!;
        final width = constraints.maxWidth;
        // Laid out narrower than its own padding for a moment (a window or a drawer settling): nothing to show yet
        if (width < 2 * spec.padX + 40) return const SizedBox.shrink();
        final list = view == LibraryView.list;
        final listColumns = list && widget.sideways ? 2 : 1;
        final columns = list
            ? listColumns
            : max(
                spec.min,
                ((width - 2 * spec.padX + spec.gapX) /
                        (spec.target + spec.gapX))
                    .floor(),
              );
        final cardWidth = list
            ? min(
                _listMaxWidth,
                (width - 2 * spec.padX - spec.gapX * (columns - 1)) / columns,
              ).floorToDouble()
            : ((width - 2 * spec.padX - spec.gapX * (columns - 1)) / columns)
                  .floorToDouble();
        final padX = list
            ? ((width - cardWidth * columns - spec.gapX * (columns - 1)) / 2)
                  .floorToDouble()
            : spec.padX;
        final thumb = (cardWidth * 9 / 16).roundToDouble();
        final cardHeight = list
            ? thumb + 10 + 44 + 10 + 28
            : thumb + 5 + 16 + (view == LibraryView.grid2 ? 16 : 0);
        _rowHeight = cardHeight + spec.gapY;
        _columns = columns;
        _viewport = constraints.maxHeight;
        if (_focused == null && !desktop && list) {
          WidgetsBinding.instance.addPostFrameCallback((_) => _updateFocus());
        }
        Widget grid = GridView.builder(
          key: ValueKey('grid-${library.generation}'),
          controller: _scroll,
          physics: const AlwaysScrollableScrollPhysics(),
          padding: EdgeInsets.fromLTRB(
            padX,
            10,
            padX,
            28 + MediaQuery.paddingOf(context).bottom,
          ),
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: columns,
            mainAxisSpacing: spec.gapY,
            crossAxisSpacing: spec.gapX,
            mainAxisExtent: cardHeight,
          ),
          itemCount: total,
          itemBuilder: (context, index) {
            final video = library.videoAt(index);
            return LibraryCard(
              client: library.client,
              personal: widget.personal,
              video: video,
              view: view,
              width: cardWidth,
              selected: video != null && video.id == widget.selectedId,
              onPressed: widget.onPressed,
              previews: widget.previews,
              focused: _focused == index,
              onAddTag: widget.onAddTag,
              onAddPerformer: widget.onAddPerformer,
            );
          },
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
        return GestureDetector(
          behavior: HitTestBehavior.translucent,
          onTap: widget.onBackground,
          child: grid,
        );
      },
    );
  }
}

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
