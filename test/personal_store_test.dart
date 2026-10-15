import 'dart:convert';
import 'dart:io';

import 'package:cove_client/api/cove_client.dart';
import 'package:cove_client/data/library.dart';
import 'package:flutter_test/flutter_test.dart';

/// A stand-in for Cove whose answers about the user's data come late: video 1 is neither a favorite nor saved for
/// later until a toggle says so.
Future<HttpServer> slowCove() async {
  final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  var favorite = false, later = false;
  server.listen((request) async {
    final body = await utf8.decodeStream(request);
    final json = body.isEmpty ? <String, dynamic>{} : jsonDecode(body);
    void reply(Object? payload) {
      request.response.headers.contentType = ContentType.json;
      request.response.write(jsonEncode(payload));
      request.response.close();
    }

    switch (request.uri.path) {
      case '/api/auth/login':
        reply({'token': 'a1', 'refreshToken': 'r1', 'username': 'admin'});
      // What the batch read: before the toggle that follows it
      case '/api/engagement/batch':
        final was = favorite;
        await Future<void>.delayed(const Duration(milliseconds: 300));
        reply([
          {'hostId': 1, 'isFavorite': was, 'playCount': 0},
        ]);
      case '/api/me/bookmarks/batch':
        final was = later;
        await Future<void>.delayed(const Duration(milliseconds: 300));
        reply([
          {'hostId': 1, 'saved': was},
        ]);
      case '/api/engagement/video/1/favorite':
        favorite = json['isFavorite'] == true;
        reply({});
      case '/api/me/bookmarks':
        later = json['saved'] == true;
        reply({});
      default:
        request.response.statusCode = 404;
        reply({});
    }
  });
  return server;
}

void main() {
  test('a toggle while the batch is on its way is not undone by its answer', () async {
    final server = await slowCove();
    addTearDown(() => server.close(force: true));
    final client = await CoveClient.login(
      'http://127.0.0.1:${server.port}',
      'admin',
      'adminadmin',
    );
    addTearDown(client.dispose);
    final store = PersonalStore(client);
    final video = Video.fromJson({'id': 1, 'files': []});

    // The card shows: its data is asked for; the user taps before the answer
    expect(store.of(video), isNull);
    await Future<void>.delayed(const Duration(milliseconds: 50));
    await store.toggleFavorite(video);
    await store.toggleSavedForLater(video);
    await Future<void>.delayed(const Duration(milliseconds: 600));

    final personal = store.of(video)!;
    expect(personal.favorite, isTrue);
    expect(personal.savedForLater, isTrue);
  });
}
