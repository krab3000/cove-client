import 'package:flutter/widgets.dart';

import '../../../state/sign_in.dart';
import '../../../theme/tokens.dart';
import '../../../ui/button.dart';
import '../../../ui/icon_button.dart';
import '../../../ui/icons.dart';
import '../../../ui/misc.dart';
import '../../../ui/pressable.dart';
import '../../../utils/format.dart';

/// The servers you added (design 1n's left pane): an editable list (⋮: Edit, Remove; Add server). A row selects its
/// server, whose accounts are beside the list.
class ServerList extends StatelessWidget {
  const ServerList({
    super.key,
    required this.state,
    required this.reached,
    required this.selectedId,
    required this.menuId,
    required this.onPick,
    required this.onMenu,
    required this.onAdd,
    required this.onSettings,
    this.large = true,
  });

  // This device's settings: a gear by the brand (phone), Settings at the foot of the list (tablet)
  final VoidCallback onSettings;
  // A phone (1a): one list at a time, its rows open the accounts (a caret), the last used ringed
  final bool large;

  final SignIn state;
  // Whether each server answers, by id (null: still asking)
  final Map<String, bool?> reached;
  final String? selectedId;
  // The server whose ⋮ menu is open
  final String? menuId;
  final ValueChanged<String> onPick;
  // ⋮: the server, and where its button is (the popover goes under it)
  final void Function(KeptServer server, Rect anchor) onMenu;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    return ClipRect(
      child: Stack(
        fit: StackFit.expand,
        children: [
          // 1a's accent glow, in the pane's corner
          Positioned(
            top: -120,
            left: -80,
            width: 420,
            height: 420,
            child: IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: RadialGradient(
                    colors: [Nocturne.accentAlpha(22), Nocturne.accentAlpha(0)],
                    stops: const [0, 0.7],
                  ),
                ),
              ),
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: ListView(
                  padding: EdgeInsets.only(
                    top: 28 + MediaQuery.paddingOf(context).top,
                    bottom: 30,
                  ),
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 24),
                      child: Row(
                        children: [
                          CoveMark(size: large ? 22 : 24),
                          const SizedBox(width: 8),
                          Text('Cove', style: inter(17, weight: medium)),
                          if (!large) ...[
                            const Spacer(),
                            Transform.translate(
                              offset: const Offset(10, 0),
                              child: CoveIconButton(
                                icon: Phosphor.gearSix,
                                onPressed: onSettings,
                                semanticLabel: 'Settings',
                                color: Nocturne.textAlpha(70),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    Padding(
                      padding: EdgeInsets.fromLTRB(24, large ? 28 : 22, 24, 4),
                      child: Text(
                        large
                            ? 'Connect to your library'
                            : 'Connect to\nyour library',
                        style: large
                            ? inter(
                                26,
                                weight: medium,
                                height: 32,
                                letterSpacing: -0.4,
                              )
                            : inter(
                                30,
                                weight: medium,
                                height: 36,
                                letterSpacing: -0.6,
                              ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 24),
                      child: Text(
                        'Your Cove servers',
                        style: inter(14, color: Nocturne.textAlpha(60)),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 22, 16, 0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          for (final s in state.servers) ...[
                            _ServerRow(
                              server: s,
                              online: reached[s.id],
                              selected: large
                                  ? selectedId == s.id
                                  : state.last?.serverId == s.id,
                              menuOpen: menuId == s.id,
                              caret: !large,
                              onPick: () => onPick(s.id),
                              onMenu: (anchor) => onMenu(s, anchor),
                            ),
                            const SizedBox(height: 8),
                          ],
                          if (state.servers.isEmpty && !large)
                            Padding(
                              padding: const EdgeInsets.fromLTRB(6, 4, 6, 8),
                              child: Text(
                                'Add your Cove server by the address you open it at in a browser.',
                                style: inter(
                                  13.5,
                                  color: Nocturne.textAlpha(60),
                                  height: 21,
                                ),
                              ),
                            ),
                          CoveButton(
                            label: 'Add server',
                            icon: Phosphor.plus,
                            variant: ButtonVariant.text,
                            onPressed: onAdd,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              if (large)
                Padding(
                  padding: EdgeInsets.fromLTRB(
                    16,
                    0,
                    16,
                    16 + MediaQuery.paddingOf(context).bottom,
                  ),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Pressable(
                      onPressed: onSettings,
                      semanticLabel: 'Settings',
                      builder: (context, states) => Container(
                        height: 44,
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(
                            Nocturne.radiusMd,
                          ),
                          color: states.highlighted || states.pressed
                              ? Nocturne.textAlpha(6)
                              : null,
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          spacing: 12,
                          children: [
                            Icon(
                              Phosphor.gearSix,
                              size: 20,
                              color: Nocturne.textAlpha(80),
                            ),
                            Text(
                              'Settings',
                              style: inter(14, color: Nocturne.textAlpha(80)),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ServerRow extends StatelessWidget {
  const _ServerRow({
    required this.server,
    required this.online,
    required this.selected,
    required this.menuOpen,
    required this.onPick,
    required this.onMenu,
    this.caret = false,
  });

  final bool caret;
  final KeptServer server;
  final bool? online;
  final bool selected;
  final bool menuOpen;
  final VoidCallback onPick;
  final ValueChanged<Rect> onMenu;

  @override
  Widget build(BuildContext context) {
    final signedIn = [
      for (final a in server.accounts)
        if (a.refreshToken != null) a.username,
    ];
    final status = online == false
        ? 'Offline${server.lastReached != null ? ' · last reached ${ago(server.lastReached!)}' : ''}'
        : signedIn.isNotEmpty
        ? 'Signed in as ${signedIn.join(', ')}'
        : server.accounts.isNotEmpty
        ? 'Password needed'
        : 'No accounts yet';
    final meta = inter(12, color: Nocturne.textAlpha(55));

    return Container(
      padding: const EdgeInsets.fromLTRB(6, 6, 4, 6),
      decoration: BoxDecoration(
        color: Nocturne.surface,
        borderRadius: BorderRadius.circular(Nocturne.radiusLg),
        border: Border.all(
          color: selected ? Nocturne.accent : Nocturne.accentAlpha(0),
        ),
        boxShadow: selected
            ? [BoxShadow(color: Nocturne.accentAlpha(22), blurRadius: 24)]
            : null,
      ),
      child: Row(
        children: [
          Expanded(
            child: Pressable(
              onPressed: onPick,
              semanticLabel: '${server.name}, $status',
              builder: (context, states) => Opacity(
                opacity: online == false ? 0.55 : 1,
                child: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(Nocturne.radiusMd),
                    color: states.pressed
                        ? Nocturne.textAlpha(8)
                        : states.highlighted
                        ? Nocturne.textAlpha(4)
                        : null,
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 44,
                        height: 44,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: Nocturne.accentAlpha(14),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Icon(
                          Phosphor.hardDrives,
                          size: 22,
                          color: Nocturne.accent300,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _line(server.name, inter(15, weight: medium)),
                            const SizedBox(height: 2),
                            _line(server.address, meta),
                            const SizedBox(height: 2),
                            Row(
                              children: [
                                StatusDot(on: online != false),
                                const SizedBox(width: 6),
                                Expanded(child: _line(status, meta)),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          if (caret)
            Icon(Phosphor.caretRight, size: 16, color: Nocturne.textAlpha(40)),
          const SizedBox(width: 4),
          // Its context is the ⋮ button's, so the popover can open under it
          Builder(
            builder: (button) => MoreButton(
              active: menuOpen,
              semanticLabel: '${server.name} options',
              onPressed: () {
                final box = button.findRenderObject()! as RenderBox;
                onMenu(box.localToGlobal(Offset.zero) & box.size);
              },
            ),
          ),
        ],
      ),
    );
  }

  static Widget _line(String text, TextStyle style) =>
      Text(text, maxLines: 1, overflow: TextOverflow.ellipsis, style: style);
}
