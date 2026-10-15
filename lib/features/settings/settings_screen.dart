import 'dart:io' show Platform;

import 'package:flutter/widgets.dart';

import '../../app/back.dart';
import '../../state/prefs.dart';
import '../../state/settings_nav.dart';
import '../../theme/layout.dart';
import '../../theme/tokens.dart';
import '../../ui/button.dart';
import '../../ui/icon_button.dart';
import '../../ui/icons.dart';
import '../../ui/misc.dart';
import '../../ui/pressable.dart';
import '../../ui/segmented.dart';
import '../../ui/sheet.dart';
import '../../ui/toggle.dart';

/// A row of Settings: a switch, segments, a value with its choices, or the About block and Reset.
sealed class _Row {
  const _Row();
}

class _Switch extends _Row {
  const _Switch(this.key, this.label, this.detail);
  final String key;
  final String label;
  final String detail;
}

class _Segments extends _Row {
  const _Segments(this.key, this.label, this.detail, this.options);
  final String key;
  final String label;
  final String detail;
  final List<(Object, String)> options;
}

class _Choice extends _Row {
  const _Choice(this.key, this.label, this.detail, this.explain, this.options);
  final String key;
  final String label;
  final String detail;
  final String explain;
  final List<(Object, String)> options;
}

class _About extends _Row {
  const _About();
}

class _Reset extends _Row {
  const _Reset();
}

typedef _Section = ({
  String title,
  IconData icon,
  String about,
  List<_Row> rows,
});

/// The app's own settings (design 7a–7d), kept on the device for every account on it: the rows that apply to
/// this app's player (libmpv through media_kit).
const List<_Section> _sections = [
  (
    title: 'Playback',
    icon: Phosphor.playCircle,
    about: 'How videos play, on this device.',
    rows: [
      _Switch(
        'autoplay',
        'Autoplay next',
        'When a video ends, play the next one in Up next.',
      ),
      _Switch(
        'resume',
        'Resume where you left off',
        'From where Cove saved it — unless that was the first seconds or the last 15.',
      ),
      _Choice(
        'seekStep',
        'Skip step',
        'The skip buttons, and a double tap on either side',
        'How far the skip buttons, and a double tap on either side of the video, jump.',
        [(5, '5 s'), (10, '10 s'), (15, '15 s'), (30, '30 s')],
      ),
      _Choice(
        'hideAfterMs',
        'Hide controls after',
        'Without a touch, while playing',
        "How long the player's controls stay up after the last touch. Paused, they stay.",
        [(2000, '2 s'), (3000, '3 s'), (5000, '5 s'), (0, 'Never')],
      ),
      _Segments(
        'subtitles',
        'Subtitles',
        "A video's own default track, or none. Pick another track in the player.",
        [('file', 'As the file says'), ('off', 'Off')],
      ),
      _Switch(
        'hardwareDecoding',
        'Hardware decoding',
        'Smoother, and easier on the battery. Turn it off if a video plays black, green or blocky.',
      ),
    ],
  ),
  (
    title: 'Library & previews',
    icon: Phosphor.squaresFour,
    about: "The Library's view, and what a card plays when you rest on it.",
    rows: [
      _Segments(
        'libraryView',
        'Library view',
        "Also follows the switch in the Library's toolbar.",
        [('grid2', '2 columns'), ('grid3', '3 columns'), ('list', 'List')],
      ),
      _Segments(
        'previews',
        'Previews',
        'The preview clip Cove made for a video, or nothing.',
        [('clip', 'Clip'), ('off', 'Off')],
      ),
      _Switch(
        'previewHardware',
        'Decode previews in hardware',
        'Turn off if previews stay black: some devices run out of decoders with several clips at once.',
      ),
    ],
  ),
  (
    title: 'Streaming & cache',
    icon: Phosphor.cloudArrowDown,
    about: 'How the player fetches video from your server.',
    rows: [
      _Choice(
        'memoryCacheMB',
        'Memory cache',
        'Video held in memory ahead of the playhead',
        'How much video the player holds in memory ahead of where it plays. Auto: 64 MB.',
        [
          (-1, 'Auto'),
          (16, '16 MB'),
          (32, '32 MB'),
          (64, '64 MB'),
          (128, '128 MB'),
        ],
      ),
      _Segments(
        'readAheadSec',
        'Read ahead',
        'Seconds of video fetched past the one playing. More rides out a shaky network.',
        [(10, '10 s'), (20, '20 s'), (60, '60 s'), (120, '120 s')],
      ),
      _Switch(
        'tlsVerify',
        'Check server certificates',
        "The player's own check of an https server. Off, it trusts the server the app signed in to.",
      ),
    ],
  ),
  (
    title: 'Diagnostics',
    icon: Phosphor.pulse,
    about: "For finding out why a video won't play. The logs slow playback a little.",
    rows: [
      _Switch(
        'stats',
        'Playback statistics',
        'Over the video: decoder, resolution, cache and network.',
      ),
      _Segments(
        'playerLog',
        'Player log',
        "What the player writes to the system's log.",
        [('warn', 'Warnings'), ('info', 'Info'), ('v', 'Verbose')],
      ),
    ],
  ),
  (
    title: 'About',
    icon: Phosphor.info,
    about: 'This app and this device.',
    rows: [_About(), _Reset()],
  ),
];

/// Settings (design 7d on a tablet: sections beside one section, values in a dialog; 7a on a phone: one page, values
/// in a sheet). Over everything; Back goes where it was opened from.
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final large = screenClassOf(context) == ScreenClass.large;
    return BackHandler(
      layer: Layer.settings,
      enabled: true,
      onBack: settingsNav.close,
      child: ColoredBox(
        color: Nocturne.bg,
        child: ListenableBuilder(
          listenable: Listenable.merge([prefs, settingsNav]),
          builder: (context, _) => large ? _tablet(context) : _phone(context),
        ),
      ),
    );
  }

  Widget _tablet(BuildContext context) {
    final section =
        _sections[settingsNav.section.clamp(0, _sections.length - 1)];
    final top = MediaQuery.paddingOf(context).top;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          width: 300,
          color: Nocturne.sidebar,
          padding: EdgeInsets.fromLTRB(12, 12 + top, 12, 18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Align(
                alignment: Alignment.centerLeft,
                child: Pressable(
                  onPressed: settingsNav.close,
                  semanticLabel: 'Back to ${settingsNav.from.backLabel}',
                  builder: (context, states) => Container(
                    height: 40,
                    padding: const EdgeInsets.only(left: 4, right: 12),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(Nocturne.radiusMd),
                      color: states.highlighted ? Nocturne.textAlpha(6) : null,
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      spacing: 4,
                      children: [
                        const Icon(
                          Phosphor.caretLeft,
                          size: 20,
                          color: Nocturne.text,
                        ),
                        Text(settingsNav.from.backLabel, style: inter(14)),
                      ],
                    ),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 18, 12, 2),
                child: Text(
                  'Settings',
                  style: inter(
                    28,
                    weight: medium,
                    height: 34,
                    letterSpacing: -0.4,
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 18),
                child: Text(
                  'On this device',
                  style: inter(14, color: Nocturne.textAlpha(60)),
                ),
              ),
              for (final (i, s) in _sections.indexed)
                Padding(
                  padding: const EdgeInsets.only(bottom: 2),
                  child: Pressable(
                    onPressed: () => settingsNav.show(i),
                    semanticLabel: s.title,
                    builder: (context, states) {
                      final on = i == settingsNav.section;
                      return Container(
                        height: 44,
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(
                            Nocturne.radiusMd,
                          ),
                          color: on
                              ? Nocturne.accentAlpha(13)
                              : states.highlighted || states.pressed
                              ? Nocturne.textAlpha(6)
                              : null,
                        ),
                        child: Row(
                          spacing: 12,
                          children: [
                            Icon(
                              on ? Phosphor.fill(s.icon) : s.icon,
                              size: 20,
                              color: on
                                  ? Nocturne.accent
                                  : Nocturne.textAlpha(78),
                            ),
                            Text(
                              s.title,
                              style: inter(
                                14,
                                color: on
                                    ? Nocturne.accent
                                    : Nocturne.textAlpha(85),
                              ),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                ),
              const Spacer(),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Text(
                  "For everyone who uses Cove on this device. Your server's own settings are in Cove's web UI.",
                  style: inter(12, color: Nocturne.textAlpha(50), height: 18),
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: SingleChildScrollView(
            padding: EdgeInsets.fromLTRB(28, 30 + top, 28, 40),
            child: Align(
              alignment: Alignment.topLeft,
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 660),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      section.title,
                      style: inter(24, weight: medium, height: 30),
                    ),
                    Padding(
                      padding: const EdgeInsets.only(top: 4, bottom: 18),
                      child: Text(
                        section.about,
                        style: inter(14, color: Nocturne.textAlpha(60)),
                      ),
                    ),
                    for (final row in section.rows)
                      _SettingRow(row: row, large: true),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _phone(BuildContext context) {
    final padding = MediaQuery.paddingOf(context);
    return ListView(
      padding: EdgeInsets.fromLTRB(
        16,
        padding.top + 4,
        16,
        padding.bottom + 32,
      ),
      children: [
        Align(
          alignment: Alignment.centerLeft,
          child: CoveIconButton(
            icon: Phosphor.caretLeft,
            onPressed: settingsNav.close,
            semanticLabel: 'Back',
            iconSize: 20,
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(8, 12, 8, 4),
          child: Text(
            'Settings',
            style: inter(30, weight: medium, height: 36, letterSpacing: -0.6),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
          child: Text(
            'Kept on this device, for every account on it.',
            style: inter(14, color: Nocturne.textAlpha(60)),
          ),
        ),
        for (final s in _sections) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 22, 8, 6),
            child: Text(
              s.title.toUpperCase(),
              style: inter(
                11.5,
                color: Nocturne.textAlpha(50),
                letterSpacing: 0.9,
              ),
            ),
          ),
          for (final row in s.rows) _SettingRow(row: row, large: false),
        ],
      ],
    );
  }
}

class _SettingRow extends StatelessWidget {
  const _SettingRow({required this.row, required this.large});

  final _Row row;
  final bool large;

  @override
  Widget build(BuildContext context) {
    Widget labels(String label, String detail) => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 3,
      children: [
        Text(label, style: inter(15)),
        Text(
          detail,
          style: inter(12, color: Nocturne.textAlpha(55), height: 17),
        ),
      ],
    );
    final padding = EdgeInsets.symmetric(
      horizontal: large ? 0 : 8,
      vertical: 10,
    );
    switch (row) {
      case _Switch(:final key, :final label, :final detail):
        final on = prefs.get<bool>(key);
        return Pressable(
          onPressed: () => prefs.set(key, !on),
          semanticLabel: label,
          builder: (context, states) => Container(
            constraints: const BoxConstraints(minHeight: 60),
            padding: padding,
            child: Row(
              spacing: 16,
              children: [
                Expanded(child: labels(label, detail)),
                Toggle(on: on),
              ],
            ),
          ),
        );
      case _Segments(:final key, :final label, :final detail, :final options):
        return Padding(
          padding: padding,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            spacing: 10,
            children: [
              labels(label, detail),
              Segmented<Object>(
                options: options,
                value: prefs.get<Object>(key),
                onChanged: (v) => prefs.set(key, v),
              ),
            ],
          ),
        );
      case _Choice(:final key, :final label, :final detail, :final options):
        final value = prefs.get<Object>(key);
        final current =
            options.where((o) => o.$1 == value).firstOrNull?.$2 ?? '$value';
        return Pressable(
          onPressed: () => _choose(context, row as _Choice),
          semanticLabel: '$label: $current',
          builder: (context, states) => Container(
            constraints: const BoxConstraints(minHeight: 60),
            padding: padding,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(Nocturne.radiusMd),
              color: states.highlighted || states.pressed
                  ? Nocturne.textAlpha(4)
                  : null,
            ),
            child: Row(
              spacing: 10,
              children: [
                Expanded(child: labels(label, detail)),
                Text(current, style: inter(14, color: Nocturne.accent300)),
                Icon(
                  Phosphor.caretRight,
                  size: 14,
                  color: Nocturne.textAlpha(45),
                ),
              ],
            ),
          ),
        );
      case _About():
        return Padding(
          padding: EdgeInsets.symmetric(
            horizontal: large ? 0 : 8,
            vertical: 14,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            spacing: 16,
            children: [
              const CoveMark(size: 48),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: 3,
                  children: [
                    Text('Cove', style: inter(17, weight: medium)),
                    Text(
                      'Version 0.1.0',
                      style: inter(13, color: Nocturne.textAlpha(60)),
                    ),
                    Text(
                      'This device: ${_device()}',
                      style: inter(13, color: Nocturne.textAlpha(60)),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Settings here are kept on this device, for every account on it. Signing out keeps them.',
                      style: inter(
                        12.5,
                        color: Nocturne.textAlpha(55),
                        height: 18,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      case _Reset():
        return Padding(
          padding: EdgeInsets.symmetric(horizontal: large ? 0 : 8, vertical: 8),
          child: Align(
            alignment: Alignment.centerLeft,
            child: CoveButton(
              label: 'Reset to defaults',
              icon: Phosphor.arrowCounterClockwise,
              variant: ButtonVariant.secondary,
              onPressed: prefs.reset,
            ),
          ),
        );
    }
  }

  /// A value's choices: a dialog on a tablet (7d), a sheet on a phone (7b); picking one closes it.
  void _choose(BuildContext context, _Choice choice) {
    Widget list(BuildContext inner) => SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 0, 8, 10),
            child: Text(
              choice.explain,
              style: inter(13, color: Nocturne.textAlpha(60), height: 19),
            ),
          ),
          for (final (value, label) in choice.options)
            Pressable(
              onPressed: () {
                prefs.set(choice.key, value);
                Navigator.of(inner).pop();
              },
              semanticLabel: label,
              builder: (context, states) {
                final on = prefs.get<Object>(choice.key) == value;
                return Container(
                  height: 52,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(Nocturne.radiusMd),
                    color: states.highlighted || states.pressed
                        ? Nocturne.textAlpha(6)
                        : null,
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          label,
                          style: inter(
                            15,
                            color: on ? Nocturne.accent200 : Nocturne.text,
                          ),
                        ),
                      ),
                      if (on)
                        const Icon(
                          Phosphor.check,
                          size: 18,
                          color: Nocturne.accent,
                        ),
                    ],
                  ),
                );
              },
            ),
        ],
      ),
    );
    if (large) {
      showCoveDialog<void>(context, title: choice.label, builder: list);
    } else {
      showSheet<void>(
        context,
        builder: (sheet) => Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SheetHeading(choice.label),
            Flexible(child: list(sheet)),
          ],
        ),
      );
    }
  }

  static String _device() {
    try {
      if (Platform.isMacOS) return 'macOS';
      if (Platform.isWindows) return 'Windows';
      if (Platform.isAndroid) return 'Android';
      if (Platform.isIOS) return 'iOS';
      return Platform.operatingSystem;
    } catch (_) {
      return 'this device';
    }
  }
}
