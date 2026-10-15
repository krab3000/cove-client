import 'package:collection/collection.dart';
import 'package:flutter/widgets.dart';

import '../../api/cove_client.dart';
import '../../ui/sheet.dart';
import '../../theme/layout.dart';
import '../../state/settings_nav.dart';
import '../../app/back.dart';
import '../../data/reachability.dart';
import '../../state/accounts.dart';
import '../../state/session.dart';
import '../../state/sign_in.dart';
import '../../theme/tokens.dart';
import '../../ui/button.dart';
import '../../ui/drawer.dart';
import '../../ui/icons.dart';
import '../../ui/misc.dart';
import '../../ui/popover.dart';
import 'components/accounts_pane.dart';
import 'components/server_form.dart';
import 'components/server_list.dart';
import 'components/unreachable.dart';

/// Signing in on a tablet (design 1n, 1o): the servers you added on the left — an editable list (⋮: Edit, Remove;
/// Add server) — and on the right the accounts kept on this device for the one picked. Cove has no discovery and
/// lists users only to admins, so both lists are the device's own.
class SignInScreen extends StatefulWidget {
  const SignInScreen({super.key});

  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  // Opens on this server's accounts (after signing out of it, or when its session couldn't be resumed)
  late String? _serverId = session.signInServerId;
  // The server whose ⋮ popover is open
  String? _menuId;
  // The add / edit drawer: open, and for which server (null: adding)
  bool _editorOpen = false;
  KeptServer? _editing;
  final _draftAddress = TextEditingController();
  final _draftName = TextEditingController();

  // A server that answered: when it was last reached (the list says so while it is away)
  late final _reachability = Reachability(
    onReached: (address) {
      final now = DateTime.now();
      accounts.change(
        (s) => SignIn(
          servers: [
            for (final x in s.servers)
              x.address == address ? x.copyWith(lastReached: now) : x,
          ],
          last: s.last,
        ),
      );
    },
  );

  @override
  void dispose() {
    _reachability.dispose();
    _draftAddress.dispose();
    _draftName.dispose();
    super.dispose();
  }

  bool get _large => screenClassOf(context) == ScreenClass.large;

  /// Add / edit a server: a drawer on a tablet (1o), a sheet on a phone (1a).
  void _openEditor(KeptServer? server) {
    _draftAddress.text = server?.address ?? '';
    _draftName.text = server?.name ?? '';
    if (_large) {
      setState(() {
        _editing = server;
        _editorOpen = true;
      });
      return;
    }
    _editing = server;
    _editorOpen = true;
    showSheet<void>(
      context,
      builder: (sheet) => ServerForm(
        drawer: false,
        adding: server == null,
        address: _draftAddress,
        name: _draftName,
        onCancel: () => Navigator.of(sheet).pop(),
        onSave: () {
          _saveServer();
          Navigator.of(sheet).pop();
        },
      ),
    ).then((_) => _editorOpen = false);
  }

  void _closeEditor() => setState(() => _editorOpen = false);

  void _saveServer() {
    final address = normalizeAddress(_draftAddress.text);
    if (address.isEmpty || !_editorOpen) return;
    final name = _draftName.text.trim().isEmpty
        ? hostOf(address)
        : _draftName.text.trim();
    final editing = _editing;
    if (editing == null) {
      final id = newServerId();
      accounts.change(
        (s) => SignIn(
          servers: [
            ...s.servers,
            KeptServer(
              id: id,
              name: name,
              address: address,
              accounts: const [],
              lastReached: null,
            ),
          ],
          last: s.last,
        ),
      );
      // A tablet goes on to the new server's first account
      if (_large) _serverId = id;
    } else {
      accounts.change(
        (s) => withServer(
          s,
          editing.id,
          (x) => x.copyWith(name: name, address: address),
        ),
      );
    }
    _closeEditor();
  }

  void _removeServer(KeptServer target) {
    for (final a in target.accounts) {
      if (a.refreshToken != null) {
        CoveClient.revoke(target.address, a.refreshToken!);
      }
    }
    accounts.change(
      (s) => SignIn(
        servers: [
          for (final x in s.servers)
            if (x.id != target.id) x,
        ],
        last: s.last?.serverId == target.id ? null : s.last,
      ),
    );
    if (_serverId == target.id) setState(() => _serverId = null);
  }

  Future<void> _openMenu(KeptServer server, Rect anchor) async {
    setState(() => _menuId = server.id);
    final entries = <Object>[
      MenuEntry(
        icon: Phosphor.pencilSimple,
        label: 'Edit',
        onPressed: () => _openEditor(server),
      ),
      const Rule(),
      MenuEntry(
        icon: Phosphor.trash,
        label: 'Remove server',
        detail: 'Forgets its address and the accounts kept for it',
        onPressed: () => _removeServer(server),
      ),
    ];
    if (!_large) {
      await showMenuSheet(
        context,
        entries: entries,
        caption: '${server.name} · ${server.address}',
      );
      if (mounted) setState(() => _menuId = null);
      return;
    }
    await showPopover(
      context,
      anchor: anchor,
      entries: [
        MenuEntry(
          icon: Phosphor.pencilSimple,
          label: 'Edit',
          onPressed: () => _openEditor(server),
        ),
        const Rule(),
        MenuEntry(
          icon: Phosphor.trash,
          label: 'Remove server',
          detail: 'Forgets its address and the accounts kept for it',
          onPressed: () => _removeServer(server),
        ),
      ],
    );
    if (mounted) setState(() => _menuId = null);
  }

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Nocturne.bg,
      child: ListenableBuilder(
        listenable: Listenable.merge([accounts, _reachability]),
        builder: (context, _) {
          final state = accounts.state;
          // Always one server's accounts: the one picked, else the last used, else the first
          final server =
              state.servers.firstWhereOrNull((s) => s.id == _serverId) ??
              state.servers.firstWhereOrNull(
                (s) => s.id == state.last?.serverId,
              ) ??
              state.servers.firstOrNull;
          final reached = {
            for (final s in state.servers) s.id: _reachability.of(s.address),
          };
          if (!_large) {
            final picked = state.servers.firstWhereOrNull(
              (s) => s.id == _serverId,
            );
            return BackHandler(
              layer: Layer.screen,
              enabled: picked != null,
              onBack: () => setState(() => _serverId = null),
              child: picked == null
                  ? ServerList(
                      large: false,
                      state: state,
                      reached: reached,
                      selectedId: null,
                      menuId: _menuId,
                      onPick: (id) => setState(() => _serverId = id),
                      onMenu: _openMenu,
                      onAdd: () => _openEditor(null),
                      onSettings: () => settingsNav.open(SettingsFrom.signIn),
                    )
                  : reached[picked.id] == false
                  ? Unreachable(
                      server: picked,
                      onEdit: () => _openEditor(picked),
                      onRetry: _reachability.askAgain,
                    )
                  : AccountsPane(
                      key: ValueKey(picked.id),
                      large: false,
                      server: picked,
                      onSignedIn: session.enter,
                      onBack: () => setState(() => _serverId = null),
                    ),
            );
          }
          return LayoutBuilder(
            builder: (context, constraints) => Stack(
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Portrait (820 wide): the list narrower
                    SizedBox(
                      width: constraints.maxWidth < 1000 ? 320 : 380,
                      child: ColoredBox(
                        color: Nocturne.sidebar,
                        child: ServerList(
                          state: state,
                          reached: reached,
                          selectedId: server?.id,
                          menuId: _menuId,
                          onPick: (id) => setState(() => _serverId = id),
                          onMenu: _openMenu,
                          onAdd: () => _openEditor(null),
                          onSettings: () =>
                              settingsNav.open(SettingsFrom.signIn),
                        ),
                      ),
                    ),
                    Expanded(child: _accountsPane(server, reached)),
                  ],
                ),
                // A tap beside the drawer closes it
                if (_editorOpen)
                  Positioned.fill(
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: _closeEditor,
                    ),
                  ),
                CoveDrawer(
                  open: _editorOpen,
                  onClose: _closeEditor,
                  width: 400,
                  child: ServerForm(
                    adding: _editing == null,
                    address: _draftAddress,
                    name: _draftName,
                    onCancel: _closeEditor,
                    onSave: _saveServer,
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _accountsPane(KeptServer? server, Map<String, bool?> reached) {
    if (server == null) {
      return CenteredPane(
        children: [
          const PaneTitle('Add your Cove server'),
          const PaneText('By the address you open it at in a browser.'),
          const SizedBox(height: 6),
          CoveButton(
            label: 'Add server',
            size: ButtonSize.lg,
            onPressed: () => _openEditor(null),
          ),
        ],
      );
    }
    if (reached[server.id] == false) {
      return Unreachable(
        server: server,
        onEdit: () => _openEditor(server),
        onRetry: _reachability.askAgain,
      );
    }
    return AccountsPane(
      key: ValueKey(server.id),
      server: server,
      onSignedIn: session.enter,
    );
  }
}
