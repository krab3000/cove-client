import 'package:flutter/material.dart'
    show TextField, InputDecoration, InputBorder;
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import '../../../data/library.dart';
import '../../../state/prefs.dart';
import '../../../theme/tokens.dart';
import '../../../ui/icons.dart';
import '../../../ui/popover.dart';
import '../../../ui/pressable.dart';
import '../../filter/filter_screen.dart' show EditedTag;
import 'library_sidebar.dart' show Avatar;

const _views = [
  (view: LibraryView.grid2, icon: Phosphor.squaresFour, label: 'Grid'),
  (view: LibraryView.grid3, icon: Phosphor.dotsNine, label: 'Dense grid'),
  (view: LibraryView.list, icon: Phosphor.rows, label: 'Feed'),
];

enum HeaderLayout { large, phone, sideways }

/// The Library's header (design turn 8, the filter pill), the same over all three views: the filter pill (what is
/// shown, the number of its conditions) opens everything about it; the search; Shuffle, Play all, the view switch; a
/// caption under it with Edited, the count and the sort. A tablet (8f): one row. A phone (8c): the search with the
/// avatar, then the toolbar. A phone held sideways (6f): one row, the pill two lines high.
class LibraryHeader extends StatelessWidget {
  const LibraryHeader({
    super.key,
    required this.library,
    required this.search,
    required this.view,
    required this.onView,
    required this.onPill,
    required this.onPlayAll,
    required this.layout,
    required this.username,
    required this.onAccount,
    this.filterOpen = false,
  });

  final Library library;
  final TextEditingController search;
  final LibraryView view;
  final ValueChanged<LibraryView> onView;
  // The pill: where its menu goes (a tablet), or the Show sheet (a phone)
  final ValueChanged<Rect> onPill;
  final VoidCallback onPlayAll;
  final HeaderLayout layout;
  final String username;
  final VoidCallback onAccount;
  // The filter drawer is open: the pill shows pressed
  final bool filterOpen;

  @override
  Widget build(BuildContext context) {
    final pill = Builder(
      builder: (pillContext) => Pressable(
        onPressed: () {
          final box = pillContext.findRenderObject()! as RenderBox;
          onPill(box.localToGlobal(Offset.zero) & box.size);
        },
        semanticLabel:
            'Show: ${library.title}${library.conditions > 0 ? ', ${library.conditions} conditions' : ''}',
        builder: (context, states) => _Pill(
          library: library,
          compact: layout == HeaderLayout.sideways,
          height: switch (layout) {
            HeaderLayout.large => 40,
            HeaderLayout.phone => 36,
            HeaderLayout.sideways => 44,
          },
          pressed: states.pressed,
          open: filterOpen,
          hovered: states.highlighted,
        ),
      ),
    );
    final shuffle = _IconToggle(
      icon: Phosphor.shuffle,
      label: 'Shuffle',
      on: library.shuffled,
      onPressed: library.shuffle,
    );
    final play = _PlayAll(onPressed: onPlayAll);
    final caption = Padding(
      padding: layout == HeaderLayout.large
          ? const EdgeInsets.fromLTRB(28, 8, 20, 4)
          : const EdgeInsets.fromLTRB(18, 0, 16, 6),
      child: Row(
        spacing: 6,
        children: [
          if (library.edited) const EditedTag(),
          Expanded(child: _CountLine(library.countLine)),
          _Sort(shuffled: library.shuffled),
        ],
      ),
    );
    switch (layout) {
      case HeaderLayout.large:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
              child: LayoutBuilder(
                builder: (context, box) {
                  // What the buttons leave (Shuffle, Play all, the view switch and the gaps) goes to the pill — up to
                  // 300, a little over half when that is less (a tablet held upright) — and the search takes the rest,
                  // so the buttons always sit at the row's end
                  const buttons = 36 + 36 + 98 + 4 * 8;
                  final free = box.maxWidth - buttons;
                  final pillWidth = (free * 0.55).clamp(0.0, 300.0);
                  return Row(
                    spacing: 8,
                    children: [
                      SizedBox(width: pillWidth, child: pill),
                      Expanded(child: _Search(controller: search, height: 40)),
                      shuffle,
                      play,
                      _ViewSwitch(view: view, onView: onView),
                    ],
                  );
                },
              ),
            ),
            caption,
          ],
        );
      case HeaderLayout.phone:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 6, 16, 0),
              child: Row(
                spacing: 8,
                children: [
                  Expanded(child: _Search(controller: search, height: 44)),
                  _AvatarButton(
                    username: username,
                    size: 36,
                    onPressed: onAccount,
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
              child: Row(
                spacing: 6,
                children: [
                  Expanded(child: pill),
                  shuffle,
                  play,
                  _ViewMenu(view: view, onView: onView),
                ],
              ),
            ),
            caption,
          ],
        );
      case HeaderLayout.sideways:
        return SizedBox(
          height: 60,
          child: Padding(
            padding: const EdgeInsets.only(left: 8, right: 4),
            child: Row(
              spacing: 6,
              children: [
                Expanded(
                  flex: 3,
                  child: _Search(controller: search, height: 40, compact: true),
                ),
                Expanded(flex: 3, child: pill),
                SizedBox(
                  width: 36,
                  height: 36,
                  child: Icon(
                    Phosphor.sortDescending,
                    size: 17,
                    color: Nocturne.textAlpha(75),
                  ),
                ),
                shuffle,
                const Spacer(),
                play,
                _ViewSwitch(view: view, onView: onView, compact: true),
                _AvatarButton(
                  username: username,
                  size: 32,
                  onPressed: onAccount,
                ),
              ],
            ),
          ),
        );
    }
  }
}

/// The filter pill: a bookmark for a saved filter, else a funnel; the name; the number of conditions and a caret at
/// its right end. Accent when something filters, outlined for all videos. Sideways, two lines: Edited and the count.
class _Pill extends StatelessWidget {
  const _Pill({
    required this.library,
    required this.compact,
    required this.height,
    required this.pressed,
    required this.open,
    required this.hovered,
  });

  final Library library;
  final bool compact;
  final double height;
  final bool pressed;
  final bool open;
  final bool hovered;

  @override
  Widget build(BuildContext context) {
    final on = library.filtering;
    final saved = library.savedFilter != null;
    final ink = on || open ? Nocturne.accent200 : Nocturne.text;
    final icon = saved ? Phosphor.bookmarksSimple : Phosphor.funnelSimple;
    final conditions = library.conditions;
    final line = Row(
      spacing: compact ? 5 : 6,
      children: [
        Icon(
          saved || open ? Phosphor.fill(icon) : icon,
          size: compact ? 14 : 16,
          color: ink,
        ),
        Expanded(
          child: Text(
            library.title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: inter(compact ? 14 : 13.5, weight: medium, color: ink),
          ),
        ),
        if (conditions > 0)
          Container(
            constraints: const BoxConstraints(minWidth: 20),
            height: 20,
            padding: const EdgeInsets.symmetric(horizontal: 6),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: Nocturne.accent800,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Text(
              '$conditions',
              style: inter(
                11.5,
                weight: FontWeight.w600,
                color: Nocturne.accent100,
              ),
            ),
          ),
        Icon(
          Phosphor.caretDown,
          size: 12,
          color: on ? Nocturne.accent200 : Nocturne.textAlpha(55),
        ),
      ],
    );
    return Container(
      height: height,
      padding: EdgeInsets.only(
        left: compact ? 12 : 11,
        right: compact ? 10 : 9,
      ),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(height / 2),
        border: Border.all(
          color: on || open ? Nocturne.accent : Nocturne.divider,
        ),
        color: open
            ? Nocturne.accentAlpha(22)
            : pressed
            ? Nocturne.accentAlpha(18)
            : on
            ? Nocturne.accentAlpha(hovered ? 16 : 12)
            : hovered
            ? Nocturne.textAlpha(5)
            : null,
      ),
      child: compact
          ? Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              spacing: 1,
              children: [
                line,
                Row(
                  spacing: 6,
                  children: [
                    if (library.edited) const EditedTag(),
                    Expanded(child: _CountLine(library.countLine, size: 11.5)),
                  ],
                ),
              ],
            )
          : line,
    );
  }
}

class _CountLine extends StatelessWidget {
  const _CountLine(this.text, {this.size = 12});

  final String text;
  final double size;

  @override
  Widget build(BuildContext context) => Text(
    text,
    maxLines: 1,
    overflow: TextOverflow.ellipsis,
    style: inter(
      size,
      color: Nocturne.textAlpha(55),
    ).copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
  );
}

/// The sort at the caption's end: newest added first, or a seeded random order while shuffled.
class _Sort extends StatelessWidget {
  const _Sort({required this.shuffled});

  final bool shuffled;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 28,
    child: Row(
      spacing: 5,
      children: [
        Icon(Phosphor.sortDescending, size: 14, color: Nocturne.textAlpha(75)),
        Text(
          shuffled ? 'Random' : 'Newest',
          style: inter(12, color: Nocturne.textAlpha(75)),
        ),
      ],
    ),
  );
}

/// Cove's search (title, tags, performers…, as its web UI): a pill field; an accent ring while it has text, ✕ to clear.
class _Search extends StatelessWidget {
  const _Search({
    required this.controller,
    required this.height,
    this.compact = false,
  });

  final TextEditingController controller;
  final double height;
  final bool compact;

  @override
  Widget build(BuildContext context) => ValueListenableBuilder(
    valueListenable: controller,
    builder: (context, value, _) => Container(
      height: height,
      padding: EdgeInsets.only(left: compact ? 12 : 14, right: compact ? 2 : 4),
      decoration: BoxDecoration(
        color: Nocturne.surface,
        borderRadius: BorderRadius.circular(height / 2),
        border: Border.all(
          color: value.text.isEmpty ? Nocturne.accentAlpha(0) : Nocturne.accent,
        ),
      ),
      child: Row(
        children: [
          Icon(
            Phosphor.magnifyingGlass,
            size: compact ? 16 : 18,
            color: Nocturne.textAlpha(55),
          ),
          SizedBox(width: compact ? 8 : 10),
          Expanded(
            child: TextField(
              controller: controller,
              autocorrect: false,
              cursorColor: Nocturne.accent,
              style: inter(compact ? 14 : 15, height: 20),
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                isDense: true,
                border: InputBorder.none,
                contentPadding: EdgeInsets.zero,
                hintText: compact
                    ? 'Search videos, tags…'
                    : 'Search videos, tags, performers…',
                hintStyle: inter(
                  compact ? 14 : 15,
                  height: 20,
                  color: Nocturne.textAlpha(45),
                ),
              ),
            ),
          ),
          if (value.text.isNotEmpty)
            Pressable(
              onPressed: controller.clear,
              semanticLabel: 'Clear search',
              builder: (context, states) => Container(
                width: compact ? 32 : 36,
                height: compact ? 32 : 36,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: states.highlighted ? Nocturne.textAlpha(8) : null,
                ),
                child: Icon(
                  Phosphor.x,
                  size: compact ? 14 : 15,
                  color: Nocturne.textAlpha(60),
                ),
              ),
            ),
        ],
      ),
    ),
  );
}

class _IconToggle extends StatelessWidget {
  const _IconToggle({
    required this.icon,
    required this.label,
    required this.on,
    required this.onPressed,
  });

  final IconData icon;
  final String label;
  final bool on;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Pressable(
    onPressed: onPressed,
    semanticLabel: label,
    builder: (context, states) => Container(
      width: 36,
      height: 36,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(Nocturne.radiusMd),
        color: on
            ? Nocturne.accentAlpha(12)
            : (states.highlighted ? Nocturne.textAlpha(6) : null),
      ),
      child: Icon(
        icon,
        size: 17,
        color: on ? Nocturne.accent : Nocturne.textAlpha(75),
      ),
    ),
  );
}

/// Play all: a 36 px round outlined accent button.
class _PlayAll extends StatelessWidget {
  const _PlayAll({required this.onPressed});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Pressable(
    onPressed: onPressed,
    semanticLabel: 'Play all',
    builder: (context, states) => Container(
      width: 36,
      height: 36,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: Nocturne.accent),
        color: states.pressed
            ? Nocturne.accentAlpha(22)
            : (states.highlighted ? Nocturne.accentAlpha(12) : null),
      ),
      child: Icon(
        Phosphor.fill(Phosphor.play),
        size: 14,
        color: Nocturne.accent200,
      ),
    ),
  );
}

/// The three views as icon buttons in one frame: the one in effect ringed in accent.
class _ViewSwitch extends StatelessWidget {
  const _ViewSwitch({
    required this.view,
    required this.onView,
    this.compact = false,
  });

  final LibraryView view;
  final ValueChanged<LibraryView> onView;
  final bool compact;

  @override
  Widget build(BuildContext context) => Container(
    decoration: BoxDecoration(
      borderRadius: BorderRadius.circular(Nocturne.radiusMd),
      border: Border.all(color: Nocturne.divider),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final v in _views)
          Pressable(
            onPressed: () => onView(v.view),
            semanticLabel: v.label,
            builder: (context, states) => Container(
              width: compact ? 30 : 32,
              height: compact ? 30 : 32,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(Nocturne.radiusMd),
                border: Border.all(
                  color: view == v.view
                      ? Nocturne.accent
                      : Nocturne.accentAlpha(0),
                ),
                color: view != v.view && states.highlighted
                    ? Nocturne.textAlpha(6)
                    : null,
              ),
              child: Icon(
                v.icon,
                size: compact ? 15 : 16,
                color: view == v.view
                    ? Nocturne.accent
                    : Nocturne.textAlpha(60),
              ),
            ),
          ),
      ],
    ),
  );
}

/// A phone's view switch: one button showing the view in effect, a menu of the three under it.
class _ViewMenu extends StatelessWidget {
  const _ViewMenu({required this.view, required this.onView});

  final LibraryView view;
  final ValueChanged<LibraryView> onView;

  @override
  Widget build(BuildContext context) {
    final current = _views.firstWhere((v) => v.view == view);
    return Builder(
      builder: (button) => Pressable(
        onPressed: () {
          final box = button.findRenderObject()! as RenderBox;
          showPopover(
            context,
            anchor: box.localToGlobal(Offset.zero) & box.size,
            width: 220,
            entries: [
              for (final v in _views)
                MenuEntry(
                  icon: v.icon,
                  label: v.label,
                  selected: v.view == view,
                  onPressed: () => onView(v.view),
                ),
            ],
          );
        },
        semanticLabel: 'View: ${current.label}',
        builder: (context, states) => Container(
          height: 36,
          padding: const EdgeInsets.symmetric(horizontal: 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(Nocturne.radiusMd),
            border: Border.all(color: Nocturne.divider),
            color: states.pressed ? Nocturne.textAlpha(6) : null,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            spacing: 4,
            children: [
              Icon(current.icon, size: 16, color: Nocturne.accent),
              Icon(Phosphor.caretDown, size: 12, color: Nocturne.textAlpha(55)),
            ],
          ),
        ),
      ),
    );
  }
}

class _AvatarButton extends StatelessWidget {
  const _AvatarButton({
    required this.username,
    required this.size,
    required this.onPressed,
  });

  final String username;
  final double size;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Pressable(
    onPressed: onPressed,
    semanticLabel: 'Account',
    builder: (context, states) => SizedBox(
      width: 44,
      height: 44,
      child: Center(child: Avatar(username, size: size)),
    ),
  );
}
