import 'package:cove_client/features/library/library_screen.dart';
import 'package:cove_client/features/signin/components/accounts_pane.dart';
import 'package:cove_client/features/signin/sign_in_screen.dart';
import 'package:cove_client/state/accounts.dart';
import 'package:cove_client/state/session.dart';
import 'package:cove_client/ui/icons.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

import 'harness.dart';

/// Sign-in (1a, 1b): the servers, an unreachable one, accounts, wrong and right passwords, a kept session.
void signInTests() {
  group('sign-in', () {
    testWidgets('a first launch: add a server that is not there, fix it, sign in', (
      tester,
    ) async {
      await launch(tester);
      expect(find.byType(SignInScreen), findsOneWidget);
      // A phone: one column; a tablet (1n): the servers beside the selected one
      expect(
        find.text(tablet ? 'Connect to your library' : 'Connect to\nyour library'),
        findsOneWidget,
      );
      expect(
        find.text(
          tablet
              ? 'Add your Cove server'
              : 'Add your Cove server by the address you open it at in a browser.',
        ),
        findsOneWidget,
      );

      // A server nothing answers at
      await tap(tester, find.text('Add server'));
      expect(find.text('Name (optional)'), findsOneWidget);
      await type(tester, field('https://cove.local:9999'), 'http://10.0.2.2:1');
      await type(tester, field('e.g. Living Room NAS'), 'Nowhere');
      await tap(tester, find.text('Add'));
      expect(find.text('Name (optional)'), findsNothing);
      expect(accounts.state.servers.single.address, 'http://10.0.2.2:1');
      await waitFor(tester, find.textContaining('Offline'));

      // A tablet goes on to the new server by itself; a phone picks it from the list
      if (!tablet) await tap(tester, find.text('Nowhere'));
      await waitFor(tester, find.text("Can't reach Nowhere"));
      expect(find.text('Try again'), findsOneWidget);

      // Edit it to the test server's address
      await tap(tester, find.text('Edit server'));
      expect(find.text('Edit server'), findsWidgets);
      await type(tester, field('https://cove.local:9999'), server);
      await type(tester, field('e.g. Living Room NAS'), 'Test server');
      await tap(tester, find.text('Save'));
      expect(accounts.state.servers.single.name, 'Test server');
      expect(accounts.state.servers.single.address, server);
      if (field('Username').evaluate().isEmpty) {
        await tap(tester, find.text('Test server'));
      }

      // No accounts yet: the sign-in card is open
      await waitFor(tester, field('Username'));
      expect(find.textContaining('Sign in to Test server', findRichText: true), findsOneWidget);
      await type(tester, field('Username'), username);
      await type(tester, field('Password'), 'not the password');
      await tap(tester, find.text('Sign in').last);
      await waitFor(tester, find.text('Wrong username or password.'));
      expect(session.status, SessionStatus.signedOut);

      await type(tester, field('Password'), password);
      await tap(tester, find.text('Sign in').last);
      await waitFor(tester, find.byType(LibraryScreen));
      await waitFor(tester, find.textContaining(' videos'));
      expect(session.status, SessionStatus.signedIn);
      expect(accounts.state.servers.single.accounts.single.username, username);
      expect(accounts.state.servers.single.accounts.single.refreshToken, isNotNull);
    });

    testWidgets('a kept session goes straight in on the next launch', (tester) async {
      await launchSignedIn(tester);
      // The app quits and launches again: the session resumes with its refresh token
      await tester.pumpWidget(const SizedBox());
      session.status = SessionStatus.hydrating;
      await launch(tester, clean: false);
      await waitFor(tester, find.byType(LibraryScreen));
      await waitFor(tester, find.textContaining(' videos'));
      expect(session.status, SessionStatus.signedIn);
    });

    testWidgets('log out, back in with the password, remove the account and the server', (
      tester,
    ) async {
      await launchSignedIn(tester);
      // Signed in through the app's own path, so that the account is kept
      await tap(tester, label('Account'));
      expect(inMenu(find.text('Refresh library')), findsOneWidget);
      await tap(tester, inMenu(find.text('Log out')));
      await waitFor(tester, find.byType(SignInScreen));

      // Back on the server's accounts: admin asks for the password
      await waitFor(tester, find.text("Who's watching?"));
      expect(
        find.descendant(of: find.byType(AccountsPane), matching: find.text('Password needed')),
        findsOneWidget,
      );
      await tap(tester, find.text(username));
      await waitFor(tester, find.textContaining('Password for', findRichText: true));
      await type(tester, field('Password'), password);
      await tap(tester, find.text('Sign in').last);
      await waitFor(tester, find.byType(LibraryScreen));
      await waitFor(tester, find.textContaining(' videos'));

      await account(tester, 'Log out');
      await waitFor(tester, find.text("Who's watching?"));

      // Edit: remove the account; with none left it asks for one
      await tap(tester, find.text('Edit'));
      // The ✕ on the tile (its label merges into the tile's)
      await tap(tester, find.byIcon(Phosphor.x));
      await waitFor(tester, field('Username'));
      expect(accounts.state.servers.single.accounts, isEmpty);

      // Back to the servers (a tablet shows them beside); remove the server from its ⋮ menu
      if (!tablet) await tap(tester, label('Servers'));
      await waitFor(tester, find.text('Your Cove servers'));
      await tap(tester, label('Test server options'));
      await tap(tester, inMenu(find.text('Remove server')));
      await waitGone(tester, find.text('Test server'));
      expect(accounts.state.servers, isEmpty);
    });
  });
}
