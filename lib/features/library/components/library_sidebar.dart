import 'package:flutter/widgets.dart';

import '../../../data/library.dart';
import '../../../api/models.dart';
import '../../../theme/tokens.dart';
import '../../../ui/icon_button.dart';
import '../../../ui/icons.dart';
import '../../../ui/misc.dart';
import '../../../ui/pressable.dart';
import '../../../utils/format.dart';

/// The tablet's sidebar (design 1h), always open: what the Library shows — all videos (with the count), the quick
/// filters (Watch), the saved filters with their counts — and the account as its bottom row.
class LibrarySidebar extends StatelessWidget {
  const LibrarySidebar({
    super.key,
    required this.library,
    required this.username,
    required this.onAll,
    required this.onQuick,
    required this.onSaved,
    required this.onSaveNew,
    required this.onAccount,
    required this.onSettings,
  });

  final Library library;
  // Pick what the Library shows
  final VoidCallback onAll;
  final ValueChanged<Quick> onQuick;
  final ValueChanged<SavedFilter> onSaved;
  final VoidCallback onSaveNew;
  final VoidCallback onSettings;
  final String username;
  // The account row: where its menu goes
  final ValueChanged<Rect> onAccount;

  @override
  Widget build(BuildContext context) {
    final active = library.active;
    final canSaveNew =
        library.savedFilter == null &&
        (library.tree.children.isNotEmpty || library.searched);
    String count(int? n) => n == null ? '' : formatCount(n);
    return ColoredBox(
      color: Nocturne.sidebar,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(12, 20, 12, 12),
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(10, 6, 10, 14),
                  child: Row(
                    children: [
                      const CoveMark(size: 22),
                      const SizedBox(width: 8),
                      Text('Cove', style: inter(17, weight: medium)),
                    ],
                  ),
                ),
                Container(
                  margin: const EdgeInsets.fromLTRB(4, 0, 4, 14),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(Nocturne.radiusMd),
                    border: Border.all(color: Nocturne.divider),
                  ),
                  child: Row(
                    children: [
                      const StatusDot(on: true),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          library.client.server.replaceFirst(
                            RegExp(r'^https?://'),
                            '',
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: inter(12.5),
                        ),
                      ),
                    ],
                  ),
                ),
                _Row(
                  icon: Phosphor.squaresFour,
                  label: 'Library',
                  meta: count(library.allCount),
                  on: active.all,
                  big: true,
                  onPressed: onAll,
                ),
                const _Section('WATCH'),
                for (final quick in Quick.values)
                  _Row(
                    icon: quick.icon,
                    label: quick.label,
                    on: active.quick == quick,
                    onPressed: () => onQuick(quick),
                  ),
                if (library.saved.isNotEmpty) const _Section('SAVED FILTERS'),
                for (final filter in library.saved)
                  _Row(
                    icon: Phosphor.bookmarksSimple,
                    label: filter.name,
                    meta: count(library.savedCounts[filter.id]),
                    on: active.savedId == filter.id,
                    onPressed: () => onSaved(filter),
                  ),
                if (canSaveNew)
                  Pressable(
                    onPressed: onSaveNew,
                    semanticLabel: 'Save as new filter',
                    builder: (context, states) => Container(
                      height: 38,
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(Nocturne.radiusMd),
                        color: states.highlighted || states.pressed
                            ? Nocturne.textAlpha(6)
                            : null,
                      ),
                      child: Row(
                        spacing: 12,
                        children: [
                          const Icon(
                            Phosphor.plus,
                            size: 18,
                            color: Nocturne.accent200,
                          ),
                          Text(
                            'Save as new filter…',
                            style: inter(13.5, color: Nocturne.accent200),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
            child: Row(
              spacing: 2,
              children: [
                Expanded(
                  child: Builder(
                    builder: (row) => Pressable(
                      onPressed: () {
                        final box = row.findRenderObject()! as RenderBox;
                        onAccount(box.localToGlobal(Offset.zero) & box.size);
                      },
                      semanticLabel: 'Account',
                      builder: (context, states) => Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 8,
                        ),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(
                            Nocturne.radiusMd,
                          ),
                          color: states.highlighted || states.pressed
                              ? Nocturne.textAlpha(6)
                              : null,
                        ),
                        child: Row(
                          children: [
                            Avatar(username, size: 32),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                username,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: inter(13.5),
                              ),
                            ),
                            Icon(
                              Phosphor.caretUpDown,
                              size: 16,
                              color: Nocturne.textAlpha(55),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
                CoveIconButton(
                  icon: Phosphor.gearSix,
                  onPressed: onSettings,
                  semanticLabel: 'Settings',
                  box: 40,
                  iconSize: 19,
                  color: Nocturne.textAlpha(70),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(12, 18, 12, 6),
    child: Text(
      text,
      style: inter(10.5, color: Nocturne.textAlpha(45), letterSpacing: 1),
    ),
  );
}

class _Row extends StatelessWidget {
  const _Row({
    required this.icon,
    required this.label,
    required this.on,
    required this.onPressed,
    this.meta = '',
    this.big = false,
  });

  final IconData icon;
  final String label;
  final String meta;
  final bool on;
  final bool big;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 2),
    child: Pressable(
      onPressed: onPressed,
      semanticLabel: label,
      builder: (context, states) => Container(
        height: big ? 42 : 38,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(Nocturne.radiusMd),
          color: on
              ? Nocturne.accentAlpha(13)
              : states.highlighted || states.pressed
              ? Nocturne.textAlpha(6)
              : null,
        ),
        child: Row(
          children: [
            Icon(
              on ? Phosphor.fill(icon) : icon,
              size: big ? 20 : 18,
              color: on ? Nocturne.accent : Nocturne.textAlpha(78),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: inter(
                  big ? 14 : 13.5,
                  color: on ? Nocturne.accent : Nocturne.textAlpha(78),
                ),
              ),
            ),
            if (meta.isNotEmpty)
              Text(
                meta,
                style: inter(
                  11.5,
                  color: Nocturne.textAlpha(45),
                ).copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
              ),
          ],
        ),
      ),
    ),
  );
}

/// An account's avatar: its initial on accent-800.
class Avatar extends StatelessWidget {
  const Avatar(this.name, {super.key, this.size = 32});

  final String name;
  final double size;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    alignment: Alignment.center,
    decoration: const BoxDecoration(
      shape: BoxShape.circle,
      color: Nocturne.accent800,
    ),
    child: Text(
      initialOf(name),
      style: inter(size * 0.42, weight: medium, color: Nocturne.accent100),
    ),
  );
}
