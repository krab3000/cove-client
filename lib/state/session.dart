import 'package:collection/collection.dart';
import 'package:flutter/widgets.dart';

import '../api/cove_client.dart';
import 'accounts.dart';
import 'player.dart';
import 'prefs.dart';
import 'sign_in.dart';

enum SessionStatus { hydrating, resuming, signedOut, signedIn }

/// The session the app is in: reading what was kept, resuming the last session, signed out (signing in), or signed
/// in with a client. Signing in opens on [signInServerId]'s accounts (the server last signed out of, or whose
/// session didn't resume).
class Session extends ChangeNotifier {
  SessionStatus status = SessionStatus.hydrating;
  CoveClient? client;
  String? serverId;
  String? signInServerId;
  AppLifecycleListener? _foreground;

  /// At launch: what was kept, then the session the app was in, if it is still good.
  Future<void> start() async {
    await (accounts.hydrate(), prefs.hydrate()).wait;
    final last = accounts.state.last;
    final server = accounts.state.servers.firstWhereOrNull(
      (s) => s.id == last?.serverId,
    );
    final account = server?.accounts.firstWhereOrNull(
      (a) => a.username == last?.username,
    );
    signInServerId = last?.serverId;
    if (server == null || account?.refreshToken == null) {
      _set(SessionStatus.signedOut);
      return;
    }
    _set(SessionStatus.resuming);
    try {
      enter(
        await CoveClient.resume(
          server.address,
          account!.username,
          account.refreshToken!,
        ),
        server.id,
      );
    } catch (e) {
      // Ran out: the account asks for its password; offline: it is tried again from the list
      if (authFailure(e) == AuthFailure.expired) {
        accounts.change(
          (state) => withServer(
            state,
            server.id,
            (x) => withAccount(x, account!.username, null),
          ),
        );
      }
      signInServerId = server.id;
      _set(SessionStatus.signedOut);
    }
  }

  /// Signed in: the session is kept (its refresh token follows every rotation) and resumes on the next launch.
  void enter(CoveClient client, String serverId) {
    _end();
    // Back in front: timers may not have run, so a token that ran out is renewed now
    _foreground = AppLifecycleListener(
      onResume: () => client.renewIfExpiring().catchError((_) {}),
    );
    client.onRefreshToken = (refreshToken) => accounts.change(
      (state) => withServer(
        state,
        serverId,
        (server) => withAccount(server, client.username, refreshToken),
      ),
    );
    accounts.change(
      (state) => SignIn(
        servers: withServer(
          state,
          serverId,
          (server) => withAccount(
            server,
            client.username,
            client.currentRefreshToken,
          ).copyWith(lastReached: DateTime.now()),
        ).servers,
        last: (serverId: serverId, username: client.username),
      ),
    );
    this.client = client;
    this.serverId = serverId;
    _set(SessionStatus.signedIn);
  }

  /// Log out: the session ends (on the server too); the account stays on the device, asking for its password.
  void logout() {
    final client = this.client, serverId = this.serverId;
    if (client == null || serverId == null) return;
    client.onRefreshToken = null;
    player.close();
    _end();
    client.logout();
    accounts.change(
      (state) => SignIn(
        servers: withServer(
          state,
          serverId,
          (server) => withAccount(server, client.username, null),
        ).servers,
        last: null,
      ),
    );
    signInServerId = serverId;
    this.client = null;
    this.serverId = null;
    _set(SessionStatus.signedOut);
  }

  void _end() {
    _foreground?.dispose();
    _foreground = null;
    client?.dispose();
  }

  void _set(SessionStatus status) {
    this.status = status;
    notifyListeners();
  }
}

final session = Session();
