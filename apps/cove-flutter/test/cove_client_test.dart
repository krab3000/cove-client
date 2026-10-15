import 'dart:convert';
import 'dart:io';

import 'package:cove_client/api/cove_client.dart';
import 'package:flutter_test/flutter_test.dart';

/// A stand-in for Cove's auth endpoints: one user (admin / adminadmin), rotating refresh tokens.
Future<HttpServer> fakeCove() async {
  final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  var refreshToken = 'r1';
  server.listen((request) async {
    final body = await utf8.decodeStream(request);
    final json = body.isEmpty ? <String, dynamic>{} : jsonDecode(body);
    void reply(int status, Object? payload) {
      request.response.statusCode = status;
      request.response.headers.contentType = ContentType.json;
      request.response.write(jsonEncode(payload));
      request.response.close();
    }

    switch (request.uri.path) {
      case '/api/system/status':
        reply(200, {'status': 'ok'});
      case '/api/auth/login':
        if (json['username'] == 'admin' && json['password'] == 'adminadmin') {
          reply(200, {
            'token': 'a1',
            'refreshToken': refreshToken,
            'username': 'admin',
          });
        } else {
          reply(401, {'code': 'INVALID_CREDENTIALS', 'message': 'nope'});
        }
      case '/api/auth/refresh':
        if (json['refreshToken'] == refreshToken) {
          refreshToken = '${refreshToken}x';
          reply(200, {
            'token': 'a2',
            'refreshToken': refreshToken,
            'user': {'id': 1, 'username': 'admin'},
          });
        } else {
          reply(401, {'message': 'expired'});
        }
      case '/api/auth/logout':
        request.response.statusCode = 204;
        request.response.close();
      default:
        reply(404, {});
    }
  });
  return server;
}

void main() {
  late HttpServer server;
  late String address;

  setUp(() async {
    server = await fakeCove();
    address = 'http://127.0.0.1:${server.port}';
  });
  tearDown(() => server.close(force: true));

  test('logs in, and resumes from the refresh token', () async {
    final client = await CoveClient.login('$address/', 'admin', 'adminadmin');
    expect(client.server, address);
    expect(client.username, 'admin');
    expect(client.currentRefreshToken, 'r1');

    final resumed = await CoveClient.resume(address, 'admin', 'r1');
    expect(resumed.currentRefreshToken, 'r1x');
    client.dispose();
    resumed.dispose();
  });

  test('a wrong password and a session that ran out', () async {
    await expectLater(
      CoveClient.login(address, 'admin', 'wrong'),
      throwsA(
        isA<CoveError>().having(
          (e) => e.message,
          'message',
          'Wrong username or password.',
        ),
      ),
    );
    try {
      await CoveClient.resume(address, 'admin', 'stale');
      fail('resumed a stale session');
    } catch (e) {
      expect(authFailure(e), AuthFailure.expired);
    }
  });

  test('reachability, and a server that is not there', () async {
    expect(await CoveClient.reachable(address), isTrue);
    expect(await CoveClient.reachable('http://127.0.0.1:1'), isFalse);
    try {
      await CoveClient.login('http://127.0.0.1:1', 'admin', 'x');
      fail('logged in to nothing');
    } catch (e) {
      expect(authFailure(e), AuthFailure.offline);
      expect(e.toString(), startsWith('Cannot reach http://127.0.0.1:1: '));
    }
  });
}
