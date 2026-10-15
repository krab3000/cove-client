import 'dart:math';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import '../../../api/cove_client.dart';
import '../../../state/accounts.dart';
import '../../../state/sign_in.dart';
import '../../../theme/tokens.dart';
import '../../../ui/button.dart';
import '../../../ui/icon_button.dart';
import '../../../ui/icons.dart';
import '../../../ui/misc.dart';
import '../../../ui/pressable.dart';
import '../../../ui/text_field.dart';
import '../../../utils/format.dart';

// Avatar fills, in turn (design 1b)
const _avatars = [
  (fill: Nocturne.accent800, ink: Nocturne.accent100),
  (fill: Nocturne.neutral800, ink: Nocturne.text),
  (fill: Nocturne.accent900, ink: Nocturne.accent300),
];

/// The accounts kept on this device for a server (design 1b, in a tablet's right pane): a kept account goes straight
/// in (its session is resumed); a lock means it has no session, so the card under the avatars asks for its password.
/// Add account asks for a username and password; Edit removes accounts from this device. A server with none asks for
/// one straight away.
class AccountsPane extends StatefulWidget {
  const AccountsPane({
    super.key,
    required this.server,
    required this.onSignedIn,
    this.large = true,
    this.onBack,
  });

  // A tablet's pane: no back (the list is beside it), centred; a phone (1b): back and the server, the card docked
  final bool large;
  final VoidCallback? onBack;

  final KeptServer server;
  final void Function(CoveClient client, String serverId) onSignedIn;

  @override
  State<AccountsPane> createState() => _AccountsPaneState();
}

class _AccountsPaneState extends State<AccountsPane> {
  KeptServer get server => widget.server;
  bool get empty => server.accounts.isEmpty;

  bool _edit = false;
  // The card: adding an account, or the account asking for its password
  late bool _adding = empty;
  String? _asking;
  // The account signing in
  String? _busy;
  String _error = '';
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _passwordFocus = FocusNode();

  bool get _cardOpen => !_edit && (_adding || _asking != null);

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  void _openCard({bool adding = false, String? asking}) => setState(() {
    _adding = adding;
    _asking = asking;
    _username.clear();
    _password.clear();
    _error = '';
  });

  void _lock(String username) => accounts.change(
    (s) => withServer(s, server.id, (x) => withAccount(x, username, null)),
  );

  Future<void> _pick(KeptAccount account) async {
    if (_edit || _busy != null) return;
    if (account.refreshToken == null) {
      _openCard(asking: account.username);
      return;
    }
    setState(() {
      _adding = false;
      _asking = null;
      _error = '';
      _busy = account.username;
    });
    try {
      widget.onSignedIn(
        await CoveClient.resume(
          server.address,
          account.username,
          account.refreshToken!,
        ),
        server.id,
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = null);
      if (authFailure(e) == AuthFailure.expired) {
        // The session ran out (or was ended elsewhere): the password, then
        _lock(account.username);
        _openCard(asking: account.username);
      } else {
        setState(() => _error = e.toString());
      }
    }
  }

  Future<void> _signIn() async {
    final name = _adding ? _username.text.trim() : _asking;
    final password = _password.text;
    if (name == null || name.isEmpty || password.isEmpty || _busy != null) {
      return;
    }
    setState(() {
      _busy = name;
      _error = '';
    });
    try {
      widget.onSignedIn(
        await CoveClient.login(server.address, name, password),
        server.id,
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = null;
        _error = e.toString();
      });
    }
  }

  void _forget(KeptAccount account) {
    if (account.refreshToken != null) {
      CoveClient.revoke(server.address, account.refreshToken!);
    }
    accounts.change((s) {
      final last = s.last;
      return SignIn(
        servers: withServer(
          s,
          server.id,
          (x) => x.copyWith(
            accounts: [
              for (final a in x.accounts)
                if (a.username != account.username) a,
            ],
          ),
        ).servers,
        last: last?.serverId == server.id && last?.username == account.username
            ? null
            : last,
      );
    });
    if (_asking == account.username) setState(() => _asking = null);
  }

  @override
  void didUpdateWidget(AccountsPane old) {
    super.didUpdateWidget(old);
    // The last account removed: Edit ends, and the pane asks for one
    if (empty && old.server.accounts.isNotEmpty) {
      _edit = false;
      _adding = true;
    }
  }

  @override
  Widget build(BuildContext context) {
    final large = widget.large;
    final edit = empty
        ? null
        : CoveButton(
            label: _edit ? 'Done' : 'Edit',
            variant: ButtonVariant.text,
            onPressed: () => setState(() {
              _edit = !_edit;
              _adding = false;
              _asking = null;
            }),
          );
    final top = MediaQuery.paddingOf(context).top;
    final bottom =
        MediaQuery.viewInsetsOf(context).bottom +
        MediaQuery.paddingOf(context).bottom;
    final card = KeyedSubtree(
      // A new card (another account, or Add) starts with its own fields and focus
      key: ValueKey(_adding ? '\u0000add' : _asking),
      child: _card(),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // The top bar: only Edit / Done on a tablet (the list is beside the pane); back and the server on a phone
        Container(
          constraints: const BoxConstraints(minHeight: 52),
          padding: EdgeInsets.fromLTRB(
            large ? 16 : 4,
            12 + (large ? 0 : top),
            16,
            0,
          ),
          child: Row(
            spacing: 8,
            children: [
              if (!large) ...[
                CoveIconButton(
                  icon: Phosphor.caretLeft,
                  onPressed: widget.onBack!,
                  semanticLabel: 'Servers',
                  iconSize: 20,
                ),
                Flexible(
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      vertical: 6,
                      horizontal: 12,
                    ),
                    decoration: BoxDecoration(
                      color: Nocturne.surface,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: ServerPill(name: server.name, online: true),
                  ),
                ),
              ],
              const Spacer(),
              ?edit,
            ],
          ),
        ),
        Expanded(
          child: LayoutBuilder(
            builder: (context, box) => SingleChildScrollView(
              padding: large
                  ? const EdgeInsets.fromLTRB(24, 40, 24, 40)
                  : const EdgeInsets.only(bottom: 24),
              child: Column(
                crossAxisAlignment: large
                    ? CrossAxisAlignment.center
                    : CrossAxisAlignment.start,
                children: [
                  if (large) ...[
                    ServerPill(name: server.name, online: true),
                    const SizedBox(height: 10),
                  ],
                  Padding(
                    padding: large
                        ? EdgeInsets.zero
                        : const EdgeInsets.fromLTRB(24, 32, 24, 0),
                    child: Text(
                      empty ? 'Sign in' : "Who's watching?",
                      textAlign: large ? TextAlign.center : TextAlign.start,
                      style: inter(
                        30,
                        weight: medium,
                        height: 36,
                        letterSpacing: -0.6,
                      ),
                    ),
                  ),
                  if (!empty)
                    Padding(
                      padding: large
                          ? const EdgeInsets.only(top: 36)
                          : const EdgeInsets.fromLTRB(24, 28, 24, 0),
                      child: Wrap(
                        alignment: large
                            ? WrapAlignment.center
                            : WrapAlignment.start,
                        runSpacing: 22,
                        children: [
                          for (final (i, account) in server.accounts.indexed)
                            _AccountTile(
                              width: large
                                  ? _tileWidth
                                  : (box.maxWidth - 48) / 2,
                              account: account,
                              colors: _avatars[i % _avatars.length],
                              selected: !_edit && _asking == account.username,
                              editing: _edit,
                              busy: _busy == account.username,
                              onPressed: () => _pick(account),
                              onRemove: () => _forget(account),
                            ),
                          if (!_edit)
                            _AddTile(
                              width: large
                                  ? _tileWidth
                                  : (box.maxWidth - 48) / 2,
                              on: _adding,
                              onPressed: () => _openCard(adding: true),
                            ),
                        ],
                      ),
                    ),
                  if (_error.isNotEmpty && !_cardOpen)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(24, 20, 24, 0),
                      child: ErrorText(_error, textAlign: TextAlign.center),
                    ),
                  if (_cardOpen && large)
                    Padding(
                      padding: const EdgeInsets.only(top: 36),
                      child: card,
                    ),
                ],
              ),
            ),
          ),
        ),
        // A phone's card sits at the bottom, over the keyboard
        if (_cardOpen && !large)
          Padding(
            padding: EdgeInsets.fromLTRB(16, 0, 16, 20 + bottom),
            child: card,
          ),
      ],
    );
  }

  Widget _card() {
    return Container(
      width: widget.large ? 380 : null,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Nocturne.surface,
        borderRadius: BorderRadius.circular(Nocturne.radiusLg),
        boxShadow: const [
          BoxShadow(
            color: Color(0x4D000000),
            offset: Offset(0, 4),
            blurRadius: 14,
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text.rich(
            TextSpan(
              style: inter(13, color: Nocturne.textAlpha(65)),
              children: [
                TextSpan(text: _adding ? 'Sign in to ' : 'Password for '),
                TextSpan(
                  text: _adding ? server.name : _asking,
                  style: const TextStyle(color: Nocturne.text),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          if (_adding) ...[
            CoveTextField(
              controller: _username,
              placeholder: 'Username',
              autofocus: true,
              textInputAction: TextInputAction.next,
              onSubmitted: (_) => _passwordFocus.requestFocus(),
            ),
            const SizedBox(height: 12),
          ],
          CoveTextField(
            controller: _password,
            focusNode: _passwordFocus,
            placeholder: 'Password',
            obscure: true,
            autofocus: !_adding,
            textInputAction: TextInputAction.go,
            onSubmitted: (_) => _signIn(),
          ),
          if (_error.isNotEmpty) ...[
            const SizedBox(height: 12),
            ErrorText(_error),
          ],
          const SizedBox(height: 22),
          Row(
            children: [
              if (_adding && !empty) ...[
                CoveButton(
                  label: 'Cancel',
                  variant: ButtonVariant.secondary,
                  size: ButtonSize.lg,
                  onPressed: () => setState(() {
                    _adding = false;
                    _error = '';
                  }),
                ),
                const SizedBox(width: 8),
              ],
              Expanded(
                child: CoveButton(
                  label: 'Sign in',
                  size: ButtonSize.lg,
                  busy: _busy != null,
                  onPressed: _signIn,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

const _tileWidth = 166.0;
const _avatarSize = 112.0;

class _AccountTile extends StatelessWidget {
  const _AccountTile({
    required this.width,
    required this.account,
    required this.colors,
    required this.selected,
    required this.editing,
    required this.busy,
    required this.onPressed,
    required this.onRemove,
  });

  final double width;
  final KeptAccount account;
  final ({Color fill, Color ink}) colors;
  final bool selected;
  final bool editing;
  final bool busy;
  final VoidCallback onPressed;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final signedIn = account.refreshToken != null;
    return SizedBox(
      width: width,
      child: Pressable(
        onPressed: editing ? null : onPressed,
        semanticLabel:
            '${account.username}, ${signedIn ? 'signed in' : 'password needed'}',
        builder: (context, states) => Column(
          children: [
            SizedBox.square(
              dimension: _avatarSize,
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  Opacity(
                    opacity: editing ? 0.8 : 1,
                    child: Container(
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: colors.fill,
                        // Selected: a gap of the ground, the accent ring and its glow
                        boxShadow: selected
                            ? [
                                BoxShadow(
                                  color: Nocturne.accentAlpha(40),
                                  blurRadius: 24,
                                  spreadRadius: 5,
                                ),
                                const BoxShadow(
                                  color: Nocturne.accent,
                                  spreadRadius: 5,
                                ),
                                const BoxShadow(
                                  color: Nocturne.bg,
                                  spreadRadius: 3,
                                ),
                              ]
                            : states.highlighted
                            ? [
                                BoxShadow(
                                  color: Nocturne.textAlpha(16),
                                  spreadRadius: 2,
                                ),
                              ]
                            : null,
                      ),
                      child: busy
                          ? const Spinner()
                          : Text(
                              initialOf(account.username),
                              style: inter(
                                36,
                                weight: medium,
                                color: colors.ink,
                              ),
                            ),
                    ),
                  ),
                  if (!signedIn)
                    Positioned(
                      right: 4,
                      bottom: 4,
                      child: Container(
                        width: 28,
                        height: 28,
                        alignment: Alignment.center,
                        decoration: const BoxDecoration(
                          shape: BoxShape.circle,
                          color: Nocturne.bg,
                        ),
                        child: Icon(
                          Phosphor.fill(Phosphor.lockSimple),
                          size: 14,
                          color: Nocturne.text,
                        ),
                      ),
                    ),
                  if (editing)
                    Positioned(
                      right: 0,
                      top: 0,
                      child: Pressable(
                        onPressed: onRemove,
                        semanticLabel: 'Remove ${account.username}',
                        builder: (context, states) => Container(
                          width: 32,
                          height: 32,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: states.highlighted
                                ? Nocturne.neutral800
                                : Nocturne.surface,
                            boxShadow: const [
                              BoxShadow(color: Nocturne.bg, spreadRadius: 3),
                            ],
                          ),
                          child: const Icon(
                            Phosphor.x,
                            size: 15,
                            color: Nocturne.text,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            Text(
              account.username,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: inter(15, weight: medium),
            ),
            const SizedBox(height: 4),
            Text(
              signedIn ? 'Signed in' : 'Password needed',
              style: inter(12, color: Nocturne.textAlpha(50)),
            ),
          ],
        ),
      ),
    );
  }
}

class _AddTile extends StatelessWidget {
  const _AddTile({
    required this.width,
    required this.on,
    required this.onPressed,
  });

  final double width;
  final bool on;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: width,
    child: Pressable(
      onPressed: onPressed,
      semanticLabel: 'Add account',
      builder: (context, states) => Column(
        children: [
          CustomPaint(
            painter: _DashedRing(
              color: on || states.highlighted
                  ? Nocturne.accent
                  : Nocturne.divider,
            ),
            child: const SizedBox.square(
              dimension: _avatarSize,
              child: Icon(Phosphor.plus, size: 32, color: Nocturne.accent300),
            ),
          ),
          const SizedBox(height: 10),
          Text('Add account', style: inter(15, weight: medium)),
          const SizedBox(height: 4),
          Text(
            'Username and password',
            style: inter(12, color: Nocturne.textAlpha(50)),
          ),
        ],
      ),
    ),
  );
}

/// Add account's ring: 1.5 px, dashed.
class _DashedRing extends CustomPainter {
  const _DashedRing({required this.color});

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    const stroke = 1.5, dash = 5.0, gap = 4.0;
    final radius = size.shortestSide / 2 - stroke / 2;
    final dashes = (2 * pi * radius / (dash + gap)).floor();
    final sweep = 2 * pi / dashes;
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke;
    final rect = Rect.fromCircle(
      center: size.center(Offset.zero),
      radius: radius,
    );
    for (var i = 0; i < dashes; i++) {
      canvas.drawArc(
        rect,
        i * sweep,
        sweep * dash / (dash + gap),
        false,
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(_DashedRing old) => old.color != color;
}
