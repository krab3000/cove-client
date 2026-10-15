import 'package:flutter/widgets.dart';
import 'package:media_kit/media_kit.dart';

import '../../../state/prefs.dart';
import '../../../theme/tokens.dart';
import '../../../ui/chips.dart';
import '../../../ui/icons.dart';
import '../../../ui/misc.dart';
import '../../../ui/popover.dart';
import '../../../ui/pressable.dart';
import '../../../ui/sheet.dart';
import '../../../ui/toggle.dart';
import '../player_session.dart';

const speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

String speedLabel(double r) => '${r == r.roundToDouble() ? r.round() : r}×';

/// A track as people name it: "en · Commentary · 6ch", else "Track n".
String trackLabel(dynamic t, int index) {
  final parts = <String>[
    if ((t.language as String?)?.isNotEmpty ?? false) t.language as String,
    if ((t.title as String?)?.isNotEmpty ?? false) t.title as String,
    if (t is AudioTrack && t.channelscount != null) '${t.channelscount}ch',
  ];
  return parts.isEmpty ? 'Track ${index + 1}' : parts.join(' · ');
}

/// The Playback options (design 7c): this video's speed, audio and subtitles; the device's Hardware decoding and
/// Playback statistics; All settings. A popover above the gear on a tablet, a sheet on a phone.
class PlaybackOptions extends StatelessWidget {
  const PlaybackOptions({
    super.key,
    required this.session,
    required this.onClose,
    required this.onAllSettings,
  });

  final PlayerSession session;
  final VoidCallback onClose;
  final VoidCallback onAllSettings;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([session, prefs]),
    builder: (context, _) {
      final audio = [
        for (final t in session.tracks.audio)
          if (t.id != 'auto' && t.id != 'no') t,
      ];
      final subs = [
        for (final t in session.tracks.subtitle)
          if (t.id != 'auto' && t.id != 'no') t,
      ];
      final currentSub = session.track.subtitle.id;
      return SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Playback', style: inter(17, weight: medium)),
            const _Label('Speed'),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final r in speeds)
                  ChoiceChip(
                    label: speedLabel(r),
                    on: session.rate == r,
                    onPressed: () => session.setRate(r),
                  ),
              ],
            ),
            if (audio.length > 1) ...[
              const _Label('Audio'),
              for (final (i, t) in audio.indexed)
                _Choice(
                  label: trackLabel(t, i),
                  on: session.track.audio.id == t.id,
                  onPressed: () {
                    session.setAudio(t);
                    onClose();
                  },
                ),
            ],
            if (subs.isNotEmpty) ...[
              const _Label('Subtitles'),
              _Choice(
                label: 'Off',
                on:
                    currentSub == 'no' ||
                    currentSub == 'auto' && prefs.subtitlesOff,
                onPressed: () {
                  session.setSubtitle(SubtitleTrack.no());
                  onClose();
                },
              ),
              for (final (i, t) in subs.indexed)
                _Choice(
                  label: trackLabel(t, i),
                  on: currentSub == t.id,
                  onPressed: () {
                    session.setSubtitle(t);
                    onClose();
                  },
                ),
            ],
            const _Label('This device'),
            _SwitchRow(
              label: 'Hardware decoding',
              detail: 'Turn off if this video plays black, green or blocky. For every video on this device.',
              on: prefs.hardwareDecoding,
              onChanged: (v) {
                prefs.hardwareDecoding = v;
                session.applyHardwareDecoding();
              },
            ),
            _SwitchRow(
              label: 'Playback statistics',
              detail: 'Decoder, cache and network, over the video.',
              on: prefs.stats,
              onChanged: (v) => prefs.stats = v,
            ),
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: Rule(),
            ),
            MenuRow(
              entry: MenuEntry(
                icon: Phosphor.gearSix,
                label: 'All settings',
                detail: 'Cache, previews, diagnostics — on this device',
                onPressed: onAllSettings,
              ),
              onPressed: () {
                onClose();
                onAllSettings();
              },
            ),
          ],
        ),
      );
    },
  );
}

class _Label extends StatelessWidget {
  const _Label(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 16, bottom: 8),
    child: Text(
      text.toUpperCase(),
      style: inter(11.5, color: Nocturne.textAlpha(50), letterSpacing: 0.9),
    ),
  );
}

class _Choice extends StatelessWidget {
  const _Choice({
    required this.label,
    required this.on,
    required this.onPressed,
  });

  final String label;
  final bool on;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Pressable(
    onPressed: onPressed,
    semanticLabel: label,
    builder: (context, states) => Container(
      height: 44,
      padding: const EdgeInsets.symmetric(horizontal: 10),
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
                14.5,
                color: on ? Nocturne.accent200 : Nocturne.text,
              ),
            ),
          ),
          if (on) const Icon(Phosphor.check, size: 16, color: Nocturne.accent),
        ],
      ),
    ),
  );
}

class _SwitchRow extends StatelessWidget {
  const _SwitchRow({
    required this.label,
    required this.detail,
    required this.on,
    required this.onChanged,
  });

  final String label;
  final String detail;
  final bool on;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) => Pressable(
    onPressed: () => onChanged(!on),
    semanticLabel: label,
    builder: (context, states) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        spacing: 12,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              spacing: 2,
              children: [
                Text(label, style: inter(15)),
                Text(
                  detail,
                  style: inter(12, color: Nocturne.textAlpha(55), height: 17),
                ),
              ],
            ),
          ),
          Toggle(on: on),
        ],
      ),
    ),
  );
}

/// The options as a phone's sheet.
Future<void> showPlaybackSheet(
  BuildContext context,
  PlayerSession session,
  VoidCallback onAllSettings,
) => showSheet(
  context,
  builder: (sheet) => PlaybackOptions(
    session: session,
    onClose: () => Navigator.of(sheet).maybePop(),
    onAllSettings: onAllSettings,
  ),
);
