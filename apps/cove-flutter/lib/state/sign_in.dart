import 'dart:math';

/// An account signed in on this device: its session (Cove's refresh token), or null once it ran out or signed out.
class KeptAccount {
  const KeptAccount({required this.username, required this.refreshToken});

  final String username;
  final String? refreshToken;

  factory KeptAccount.fromJson(Map<String, dynamic> json) => KeptAccount(
    username: json['username'] as String,
    refreshToken: json['refreshToken'] as String?,
  );

  Map<String, dynamic> toJson() => {
    'username': username,
    'refreshToken': refreshToken,
  };
}

/// A Cove server added to the list (design 1a), with the accounts kept for it (1b).
class KeptServer {
  const KeptServer({
    required this.id,
    required this.name,
    required this.address,
    required this.accounts,
    required this.lastReached,
  });

  final String id;
  final String name;
  final String address;
  final List<KeptAccount> accounts;
  // When it last answered
  final DateTime? lastReached;

  KeptServer copyWith({
    String? name,
    String? address,
    List<KeptAccount>? accounts,
    DateTime? lastReached,
  }) => KeptServer(
    id: id,
    name: name ?? this.name,
    address: address ?? this.address,
    accounts: accounts ?? this.accounts,
    lastReached: lastReached ?? this.lastReached,
  );

  factory KeptServer.fromJson(Map<String, dynamic> json) => KeptServer(
    id: json['id'] as String,
    name: json['name'] as String,
    address: json['address'] as String,
    accounts: [
      for (final a in json['accounts'] as List)
        KeptAccount.fromJson(a as Map<String, dynamic>),
    ],
    lastReached: switch (json['lastReached']) {
      final num ms => DateTime.fromMillisecondsSinceEpoch(ms.toInt()),
      _ => null,
    },
  );

  // The React Native client's shape: lastReached in ms since the epoch
  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'address': address,
    'accounts': [for (final a in accounts) a.toJson()],
    'lastReached': lastReached?.millisecondsSinceEpoch,
  };
}

/// The session the app was in: it resumes there on the next launch.
typedef LastSession = ({String serverId, String username});

class SignIn {
  const SignIn({required this.servers, required this.last});

  static const empty = SignIn(servers: [], last: null);

  final List<KeptServer> servers;
  final LastSession? last;

  factory SignIn.fromJson(Map<String, dynamic> json) => SignIn(
    servers: [
      for (final s in json['servers'] as List)
        KeptServer.fromJson(s as Map<String, dynamic>),
    ],
    last: switch (json['last']) {
      {'serverId': final String serverId, 'username': final String username} =>
        (serverId: serverId, username: username),
      _ => null,
    },
  );

  Map<String, dynamic> toJson() => {
    'servers': [for (final s in servers) s.toJson()],
    'last': last == null
        ? null
        : {'serverId': last!.serverId, 'username': last!.username},
  };
}

final _scheme = RegExp(r'^[a-z][a-z0-9+.-]*://', caseSensitive: false);

/// What was typed as an address, as a base URL: https:// unless it says otherwise, no trailing slash.
String normalizeAddress(String text) {
  final trimmed = text.trim().replaceFirst(RegExp(r'/+$'), '');
  if (trimmed.isEmpty) return '';
  return _scheme.hasMatch(trimmed) ? trimmed : 'https://$trimmed';
}

/// An address's host: the name of a server added without one.
String hostOf(String address) =>
    address.replaceFirst(_scheme, '').replaceFirst(RegExp(r'[:/].*$'), '');

final _random = Random();

String newServerId() =>
    DateTime.now().millisecondsSinceEpoch.toRadixString(36) +
    _random.nextInt(1 << 30).toRadixString(36);

/// The state with one server changed.
SignIn withServer(
  SignIn state,
  String id,
  KeptServer Function(KeptServer server) change,
) => SignIn(
  servers: [for (final s in state.servers) s.id == id ? change(s) : s],
  last: state.last,
);

/// A server with an account's session set (added at the end if new).
KeptServer withAccount(
  KeptServer server,
  String username,
  String? refreshToken,
) {
  final account = KeptAccount(username: username, refreshToken: refreshToken);
  final known = server.accounts.any((a) => a.username == username);
  return server.copyWith(
    accounts: known
        ? [
            for (final a in server.accounts)
              a.username == username ? account : a,
          ]
        : [...server.accounts, account],
  );
}
