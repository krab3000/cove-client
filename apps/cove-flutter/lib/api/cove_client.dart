import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import 'models.dart';

export 'models.dart';

class CoveError implements Exception {
  CoveError(this.message, this.status, [this.code]);

  final String message;
  // 0: the server didn't answer
  final int status;
  final String? code;

  @override
  String toString() => message;
}

enum AuthFailure { expired, offline }

/// What a failure means for a session: it ran out (refused, or its refresh token rotated elsewhere: sign in again),
/// the server didn't answer, or something else (null).
AuthFailure? authFailure(Object error) {
  if (error is! CoveError) return null;
  if (error.status == 401 || error.status == 409) return AuthFailure.expired;
  if (error.status == 0) return AuthFailure.offline;
  return null;
}

// The access JWT is renewed this long before it expires (Cove's last 15 minutes by default).
const _renewEarly = Duration(minutes: 1);
// A renewal that failed (offline, the server restarting) is tried again after this long.
const _renewRetry = Duration(seconds: 30);

/// A session with a Cove server (as the React Native client's api/cove.ts): a 15-minute access JWT sent as a Bearer
/// header, renewed with the rotating refresh token a minute before it expires (and once on a 401).
class CoveClient {
  CoveClient._(
    this.server,
    this.username,
    this._accessToken,
    this._refreshToken,
  );

  final String server;
  final String username;
  String _accessToken;
  String _refreshToken;
  Future<void>? _refreshing;
  Timer? _renewTimer;

  /// Told the new refresh token whenever it rotates, so a session kept on the device follows it.
  void Function(String refreshToken)? onRefreshToken;

  static final _http = http.Client();

  static Future<CoveClient> login(
    String server,
    String username,
    String password,
  ) async {
    final base = _base(server);
    final login = await _send(base, 'POST', 'auth/login', {
      'username': username,
      'password': password,
    });
    return CoveClient._(
      base,
      login['username'] as String? ?? username,
      login['token'] as String,
      login['refreshToken'] as String,
    ).._scheduleRenewal();
  }

  /// A session kept on the device, resumed from its refresh token (rejected once it ran out).
  static Future<CoveClient> resume(
    String server,
    String username,
    String refreshToken,
  ) async {
    final base = _base(server);
    final pair = await _send(base, 'POST', 'auth/refresh', {
      'refreshToken': refreshToken,
    });
    return CoveClient._(
      base,
      (pair['user'] as Map?)?['username'] as String? ?? username,
      pair['token'] as String,
      pair['refreshToken'] as String,
    ).._scheduleRenewal();
  }

  /// Whether a server answers (Cove's status needs no sign-in), within a few seconds.
  static Future<bool> reachable(String server) async {
    try {
      await _http
          .get(Uri.parse('$server/api/system/status'))
          .timeout(const Duration(seconds: 4));
      return true; // any answer: it is there
    } catch (_) {
      return false;
    }
  }

  /// Ends a session kept on the device (an account removed from it); quietly, the device forgets it either way.
  static Future<void> revoke(String server, String refreshToken) async {
    try {
      await _send(server, 'POST', 'auth/logout', {
        'refreshToken': refreshToken,
      });
    } catch (_) {}
  }

  /// The session's refresh token now (it rotates on every refresh).
  String get currentRefreshToken => _refreshToken;

  /// Renews the JWT if it expires soon: the app is back in front, and timers may not have run.
  Future<void> renewIfExpiring() async {
    final expires = _jwtExpiry(_accessToken);
    if (expires != null &&
        expires.difference(DateTime.now()) < _renewEarly * 2) {
      await _refresh();
    } else {
      _scheduleRenewal();
    }
  }

  final _tokenListeners = <void Function(String accessToken)>{};

  /// Calls listener after every renewal with the new access JWT (a playing stream's header follows it). Returns the
  /// unsubscribe function.
  void Function() onAccessToken(void Function(String accessToken) listener) {
    _tokenListeners.add(listener);
    return () => _tokenListeners.remove(listener);
  }

  /// Renews the access JWT now (a media request was refused). One renewal runs at a time.
  Future<void> renew() => _refresh();

  /// The session is over here: no more renewals or listeners.
  void dispose() {
    _renewTimer?.cancel();
    _renewTimer = null;
    _tokenListeners.clear();
  }

  Future<void> logout() async {
    dispose();
    try {
      await _send(server, 'POST', 'auth/logout', {
        'refreshToken': _refreshToken,
      });
    } catch (_) {
      // the session ends locally either way
    }
  }

  /// An API call with the session's JWT; a 401 renews it once and asks again.
  Future<dynamic> request(
    String method,
    String path, {
    Object? body,
    bool allowRefresh = true,
  }) async {
    try {
      return await _send(server, method, path, body, _accessToken);
    } on CoveError catch (e) {
      if (!allowRefresh || e.status != 401) rethrow;
      await _refresh();
      return request(method, path, body: body, allowRefresh: false);
    }
  }

  /// The header media requests carry (covers, preview clips): the JWT now. A JWT, never an API token: Cove checks an
  /// API token with BCrypt on every request (~300 ms each), a JWT by its signature.
  Map<String, String> get authHeaders => {
    'Authorization': 'Bearer $_accessToken',
  };

  /// A page of videos (1-based), newest first, or shuffled (Cove's seeded random sort: the same seed, the same
  /// order). q is Cove's search (title, tags, performers, ... as in its web UI), on top of the filter.
  Future<VideoPage> findVideos(
    int page,
    int perPage, {
    Json? filter,
    int? seed,
    String q = '',
  }) async => VideoPage.fromJson(
    await request(
      'POST',
      'videos/find',
      body: {
        'findFilter': {
          ..._search(q),
          'page': page,
          'perPage': perPage,
          if (seed != null) ...{
            'sort': 'random',
            'direction': 'asc',
            'seed': seed,
          } else ...{
            'sort': 'created_at',
            'direction': 'desc',
            // A secondary sort keeps page boundaries stable (like Cove's CLI)
            'sorts': [
              {'key': 'created_at', 'direction': 'desc'},
              {'key': 'updated_at', 'direction': 'desc'},
            ],
          },
        },
        'filterExpression': ?filter,
      },
    ),
  );

  /// How many videos match a filter and search, their total duration and file size.
  Future<Aggregate> aggregateVideos({Json? filter, String q = ''}) async =>
      Aggregate.fromJson(
        await request(
          'POST',
          'videos/aggregate',
          body: {'findFilter': _search(q), 'filterExpression': ?filter},
        ),
      );

  /// How many videos match a filter (perPage 0: Cove only counts).
  Future<int> countVideos({Json? filter}) async =>
      (await findVideos(1, 0, filter: filter)).totalCount;

  /// The user's rating, favorite, play count and resume time for these videos, by id.
  Future<Map<int, Engagement>> engagement(List<int> ids) async => {
    for (final e in await request(
      'POST',
      'engagement/batch',
      body: {'hostType': 'video', 'hostIds': ids},
    ) as List)
      (e as Json)['hostId'] as int: Engagement.fromJson(e),
  };

  Future<void> setFavorite(int id, bool isFavorite) => request(
    'PUT',
    'engagement/video/$id/favorite',
    body: {'isFavorite': isFavorite},
  );

  /// Which of these videos the user saved for later (Cove's bookmarks).
  Future<Set<int>> savedForLater(List<int> ids) async => {
    for (final b in await request(
      'POST',
      'me/bookmarks/batch',
      body: {'hostType': 'video', 'hostIds': ids},
    ) as List)
      if ((b as Json)['saved'] == true) b['hostId'] as int,
  };

  Future<void> setSavedForLater(int id, bool saved) => request(
    'POST',
    'me/bookmarks',
    body: {'hostType': 'video', 'hostId': id, 'saved': saved},
  );

  Future<List<SavedFilter>> savedFilters() async => [
    for (final f in await request('GET', 'savedfilters?mode=videos') as List)
      SavedFilter.fromJson(f as Json),
  ];

  /// The video's segments, in time order ([] when the account may not read segments).
  Future<List<Segment>> segments(int id) async {
    try {
      return [
        for (final s in await request('GET', 'videos/$id/segments') as List)
          Segment.fromJson(s as Json),
      ];
    } catch (_) {
      return [];
    }
  }

  // Whether a video has a preview clip (Cove's generate task makes them), by video id
  final _previews = <int, Future<bool>>{};

  Future<bool> previewAvailable(int id) => _previews[id] ??= request(
    'GET',
    'stream/video/$id/preview/status',
  ).then((s) => (s as Json)['available'] == true, onError: (_) => false);

  /// The cover (generated, or a frame Cove takes), at most this wide.
  String imageUrl(Video video, {int max = 640}) =>
      '$server/api/videos/${video.id}/image?max=$max'
      '&v=${Uri.encodeQueryComponent(video.updatedAt)}';

  /// A frame of the video at a time (seconds in its file).
  String frameUrl(int id, double seconds) =>
      '$server/api/stream/video/$id/screenshot?seconds=${seconds.round()}';

  /// The short preview clip Cove's generate task makes (low resolution, a few seconds); see previewAvailable.
  String previewUrl(int id) => '$server/api/stream/video/$id/preview';

  /// The stream of the video's primary file (a clip plays the parent's file; Cove resolves it).
  String streamUrl(Video video) {
    final file = video.primaryFile;
    return '$server/api/stream/video/${video.id}${file != null ? '?fileId=${file.id}' : ''}';
  }

  /// Reports what was watched, like Cove's web player: the spans played since the last report, the position and the
  /// state ('active', 'paused', 'ended'). Cove keeps the resume position and counts views from these.
  Future<void> recordPlayback({
    required int hostId,
    required String sessionId,
    required double mediaDurationSec,
    required double currentPositionSec,
    required String state,
    required List<({double startSec, double endSec})> intervals,
  }) => request(
    'POST',
    'playback/intervals',
    body: {
      'hostType': 'video',
      'surface': 'mobile-player',
      'hostId': hostId,
      'sessionId': sessionId,
      'mediaDurationSec': mediaDurationSec,
      'currentPositionSec': currentPositionSec,
      'state': state,
      'intervals': [
        for (final i in intervals) {'startSec': i.startSec, 'endSec': i.endSec},
      ],
    },
  );

  /// Tags, performers, studios, groups or galleries matching a search, for filter value pickers.
  Future<List<Named>> lookup(String kind, String q) async {
    final nameKey = kind == 'galleries' ? 'title' : 'name';
    final params = [
      'perPage=50',
      q.trim().isNotEmpty
          ? 'q=${Uri.encodeQueryComponent(q.trim())}'
          : 'sort=$nameKey&direction=asc',
      if (kind == 'tags') 'includeCounts=false',
    ];
    final result = await request('GET', '$kind?${params.join('&')}') as Json;
    return [
      for (final item in result['items'] as List)
        Named(
          ((item as Json)['id'] as num).toInt(),
          '${item[nameKey] ?? '#${item['id']}'}',
        ),
    ];
  }

  /// The name of a tag, performer, studio, group or gallery, by id.
  Future<String> entityName(String kind, int id) async {
    final item = await request('GET', '$kind/$id') as Json;
    return '${item[kind == 'galleries' ? 'title' : 'name'] ?? '#$id'}';
  }

  /// The library's root folders, or the folders right under one of its folders. Throws a CoveError with status 403
  /// when the account may not list folders (Cove wants Library scan or Files read), or for a path outside the library.
  Future<List<LibraryFolder>> libraryFolders([String? path]) async => [
    for (final f in await request(
      'GET',
      'metadata/library-folders${path != null ? '?path=${Uri.encodeQueryComponent(path)}' : ''}',
    ) as List)
      LibraryFolder.fromJson(f as Json),
  ];

  /// How many videos match a filter and a search.
  Future<int> countMatching({Json? filter, String q = ''}) async =>
      (await findVideos(1, 0, filter: filter, q: q)).totalCount;

  /// A new saved filter; Cove refuses a name already taken (409).
  Future<SavedFilter> createSavedFilter(Json filter) async =>
      SavedFilter.fromJson(
        await request('POST', 'savedfilters', body: filter) as Json,
      );

  Future<SavedFilter> updateSavedFilter(int id, Json change) async =>
      SavedFilter.fromJson(
        await request('PUT', 'savedfilters/$id', body: change) as Json,
      );

  // Sprite sheets by video id: the player's seek bar fetches its index once
  final _sprites = <int, Future<SpriteSheet?>>{};

  /// The seek-bar thumbnails Cove's generate task makes (a sprite sheet and a WebVTT index of its cells), or null
  /// when the video has none yet. For the open player's seek bar only: a sheet is one big JPEG.
  Future<SpriteSheet?> spriteSheet(int id) => _sprites[id] ??= () async {
    try {
      final vtt = await requestText('stream/video/$id/vtt/thumbs');
      final cues = parseSpriteVtt(vtt);
      if (cues.isEmpty) return null;
      return SpriteSheet(
        '$server/api/stream/video/$id/sprite',
        cues,
        cues.map((c) => c.x + c.w).reduce((a, b) => a > b ? a : b),
        cues.map((c) => c.y + c.h).reduce((a, b) => a > b ? a : b),
      );
    } catch (_) {
      return null;
    }
  }();

  /// A text response (a VTT index) with the session's JWT.
  Future<String> requestText(String path) async {
    final response = await _http.get(
      Uri.parse('$server/api/$path'),
      headers: authHeaders,
    );
    if (response.statusCode == 401) {
      await _refresh();
      return requestText(path);
    }
    if (response.statusCode != 200)
      throw CoveError(
        'Server error ${response.statusCode}',
        response.statusCode,
      );
    return response.body;
  }

  static Json _search(String q) => q.trim().isEmpty ? {} : {'q': q.trim()};

  /// Renews the JWT a minute before it expires (again after a while if that fails, e.g. offline).
  void _scheduleRenewal([Duration? delay]) {
    _renewTimer?.cancel();
    final expires = _jwtExpiry(_accessToken);
    if (delay == null && expires == null) return;
    var wait = delay ?? expires!.difference(DateTime.now()) - _renewEarly;
    if (wait < const Duration(seconds: 5)) wait = const Duration(seconds: 5);
    _renewTimer = Timer(wait, () {
      _renewTimer = null;
      _refresh().catchError((Object e) {
        if (authFailure(e) != AuthFailure.expired) {
          _scheduleRenewal(_renewRetry);
        }
      });
    });
  }

  Future<void> _refresh() {
    // One refresh at a time: the refresh token rotates, so a second concurrent refresh would fail.
    return _refreshing ??= () async {
      try {
        final pair = await _send(server, 'POST', 'auth/refresh', {
          'refreshToken': _refreshToken,
        });
        _accessToken = pair['token'] as String;
        _refreshToken = pair['refreshToken'] as String;
        onRefreshToken?.call(_refreshToken);
        for (final listener in [..._tokenListeners]) {
          listener(_accessToken);
        }
        _scheduleRenewal();
      } finally {
        _refreshing = null;
      }
    }();
  }

  static String _base(String server) =>
      server.trim().replaceFirst(RegExp(r'/+$'), '');

  static Future<dynamic> _send(
    String server,
    String method,
    String path, [
    Object? body,
    String? accessToken,
  ]) async {
    http.Response response;
    try {
      final request = http.Request(method, Uri.parse('$server/api/$path'))
        ..headers['Accept'] = 'application/json';
      if (body != null) {
        request.headers['Content-Type'] = 'application/json';
        request.body = jsonEncode(body);
      }
      if (accessToken != null) {
        request.headers['Authorization'] = 'Bearer $accessToken';
      }
      response = await http.Response.fromStream(
        await _http.send(request).timeout(const Duration(seconds: 15)),
      );
    } catch (e) {
      throw CoveError('Cannot reach $server: ${_networkDetail(e)}', 0);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      String? code;
      var detail = '';
      try {
        final error = jsonDecode(response.body);
        if (error is Map) {
          code = error['code'] as String?;
          detail = (error['message'] ?? error['title'] ?? '').toString();
        }
      } catch (_) {}
      throw CoveError(
        _describe(response.statusCode, code, detail),
        response.statusCode,
        code,
      );
    }
    if (response.statusCode == 204 || response.body.isEmpty) return null;
    return jsonDecode(response.body);
  }
}

/// Cove's thumbs VTT: "00:00:07.971 --> 00:00:15.943" then "<id>_sprite.jpg#xywh=320,0,320,570".
List<SpriteCue> parseSpriteVtt(String vtt) {
  double seconds(String t) => t
      .split(':')
      .fold(0.0, (acc, part) => acc * 60 + (double.tryParse(part) ?? 0));
  final lines = vtt.split(RegExp(r'\r?\n'));
  final cues = <SpriteCue>[];
  final time = RegExp(r'^([\d:.]+)\s*-->\s*([\d:.]+)');
  final cell = RegExp(r'#xywh=(\d+),(\d+),(\d+),(\d+)');
  for (var i = 0; i < lines.length - 1; i++) {
    final t = time.firstMatch(lines[i].trim());
    final c = t == null ? null : cell.firstMatch(lines[i + 1]);
    if (t != null && c != null) {
      cues.add(
        SpriteCue(
          seconds(t[1]!),
          seconds(t[2]!),
          double.parse(c[1]!),
          double.parse(c[2]!),
          double.parse(c[3]!),
          double.parse(c[4]!),
        ),
      );
    }
  }
  return cues;
}

/// What went wrong on the way to the server, in a few words.
String _networkDetail(Object error) => switch (error) {
  SocketException(:final osError?) => osError.message,
  SocketException(:final message) => message,
  HandshakeException(:final message) => 'TLS: $message',
  TimeoutException() => 'no answer',
  FormatException() => 'not an address',
  _ => error.toString(),
};

String _describe(int status, String? code, String detail) {
  if (code == 'INVALID_CREDENTIALS') return 'Wrong username or password.';
  if (code == 'ACCOUNT_DISABLED') return 'This account is disabled.';
  if (status == 429) {
    return 'Too many attempts; wait a few seconds and try again.';
  }
  if (status == 401) return 'The session has expired; log in again.';
  if (status == 403) return 'This account may not do that.';
  if (status == 409 && detail.isNotEmpty) return detail;
  return 'Server error $status${detail.isNotEmpty ? ': $detail' : ''}';
}

/// When a JWT expires, from its exp claim; null if it cannot be read.
DateTime? _jwtExpiry(String token) {
  try {
    final parts = token.split('.');
    if (parts.length < 2) return null;
    final payload = jsonDecode(
      utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))),
    );
    final exp = payload['exp'];
    return exp is num
        ? DateTime.fromMillisecondsSinceEpoch((exp * 1000).round())
        : null;
  } catch (_) {
    return null;
  }
}
