import 'package:flutter/material.dart';
import 'package:media_kit/media_kit.dart';

import 'features/library/library_screen.dart';
import 'features/signin/sign_in_screen.dart';
import 'app/back.dart';
import 'features/settings/settings_screen.dart';
import 'state/session.dart';
import 'state/settings_nav.dart';
import 'theme/tokens.dart';
import 'ui/misc.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  MediaKit.ensureInitialized();
  session.start();
  runApp(const CoveApp());
}

class CoveApp extends StatelessWidget {
  const CoveApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Cove',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        fontFamily: 'Inter',
        scaffoldBackgroundColor: Nocturne.bg,
        colorScheme: const ColorScheme.dark(
          primary: Nocturne.accent,
          surface: Nocturne.surface,
          error: Nocturne.danger,
        ),
        textSelectionTheme: TextSelectionThemeData(
          cursorColor: Nocturne.accent,
          selectionColor: Nocturne.accentAlpha(35),
        ),
      ),
      home: const _Shell(),
    );
  }
}

/// Waiting (reading what was kept, resuming the last session), signing in, or signed in (the Library, with the
/// player over it); Settings over everything. Back (Android) and Escape go to the topmost layer.
class _Shell extends StatelessWidget {
  const _Shell();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Nocturne.bg,
      resizeToAvoidBottomInset: false,
      body: BackRoot(
        child: Stack(
          fit: StackFit.expand,
          children: [
            Positioned.fill(
              child: ListenableBuilder(
                listenable: session,
                builder: (context, _) => switch (session.status) {
                  SessionStatus.hydrating ||
                  SessionStatus.resuming => const Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        CoveMark(size: 48),
                        SizedBox(height: 24),
                        Spinner(),
                      ],
                    ),
                  ),
                  SessionStatus.signedOut => const SignInScreen(),
                  SessionStatus.signedIn => LibraryScreen(
                    key: ValueKey(session.client),
                    client: session.client!,
                  ),
                },
              ),
            ),
            ListenableBuilder(
              listenable: settingsNav,
              builder: (context, _) => settingsNav.isOpen
                  ? const Positioned.fill(child: SettingsScreen())
                  : const SizedBox.shrink(),
            ),
          ],
        ),
      ),
    );
  }
}
