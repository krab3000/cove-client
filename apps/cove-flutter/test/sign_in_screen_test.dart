import 'package:cove_client/features/signin/sign_in_screen.dart';
import 'package:cove_client/main.dart';
import 'package:cove_client/state/accounts.dart';
import 'package:cove_client/state/session.dart';
import 'package:cove_client/state/sign_in.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Two servers: one with a signed-in account and one whose session ran out, one with no accounts yet.
void seed() => accounts.change(
  (_) => const SignIn(
    servers: [
      KeptServer(
        id: 'nas',
        name: 'Living Room NAS',
        address: 'http://192.168.1.20:5073',
        accounts: [
          KeptAccount(username: 'maya', refreshToken: 'r'),
          KeptAccount(username: 'theo', refreshToken: null),
        ],
        lastReached: null,
      ),
      KeptServer(
        id: 'studio',
        name: 'Studio',
        address: 'https://cove.studio.lan',
        accounts: [],
        lastReached: null,
      ),
    ],
    last: (serverId: 'nas', username: 'maya'),
  ),
);

Future<void> pumpSignIn(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1180, 820);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  session.status = SessionStatus.signedOut;
  await tester.pumpWidget(const CoveApp());
  await tester.pumpAndSettle();
}

void main() {
  setUp(seed);

  testWidgets('the servers beside the last used server\'s accounts', (
    tester,
  ) async {
    await pumpSignIn(tester);
    expect(find.byType(SignInScreen), findsOneWidget);
    expect(find.text('Connect to your library'), findsOneWidget);
    expect(find.text('Signed in as maya'), findsOneWidget);
    expect(find.text('No accounts yet'), findsOneWidget);
    expect(find.text("Who's watching?"), findsOneWidget);

    // A locked account asks for its password
    await tester.tap(find.text('theo'));
    await tester.pumpAndSettle();
    expect(
      find.text('Password for '),
      findsNothing,
    ); // a span of the card's title
    expect(find.text('Password'), findsOneWidget);

    // A server with no accounts asks for one straight away
    await tester.tap(find.text('Studio'));
    await tester.pumpAndSettle();
    expect(
      find.text('Sign in'),
      findsNWidgets(2),
    ); // the heading and the button
    expect(find.text('Username'), findsOneWidget);
  });

  testWidgets('adding a server selects it', (tester) async {
    await pumpSignIn(tester);
    await tester.tap(find.text('Add server'));
    await tester.pumpAndSettle();
    expect(find.text('Name (optional)'), findsOneWidget);

    await tester.enterText(find.byType(TextField).first, 'cove.local:9999/');
    await tester.pump();
    await tester.tap(find.text('Add'));
    await tester.pumpAndSettle();

    final added = accounts.state.servers.last;
    expect(added.address, 'https://cove.local:9999');
    expect(added.name, 'cove.local');
    expect(find.text('Name (optional)'), findsNothing); // the drawer closed
    expect(find.text('Username'), findsOneWidget); // its first account
  });

  testWidgets('removing a server from its ⋮ menu', (tester) async {
    await pumpSignIn(tester);
    await tester.tap(find.bySemanticsLabel('Studio options'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Remove server'));
    await tester.pumpAndSettle();
    expect(accounts.state.servers.map((s) => s.id), ['nas']);
    expect(find.text('Studio'), findsNothing);
  });
}
