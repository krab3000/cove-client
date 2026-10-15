import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:media_kit_video/media_kit_video.dart' as mk;

import '../../api/cove_client.dart';
import '../../app/back.dart';
import '../../data/library.dart';
import '../../state/prefs.dart';
import '../../state/settings_nav.dart';
import '../../theme/layout.dart';
import '../../theme/tokens.dart';
import '../../ui/chips.dart';
import '../../ui/icon_button.dart';
import '../../ui/icons.dart';
import '../../ui/misc.dart';
import '../../ui/popover.dart';
import '../../ui/pressable.dart';
import '../../ui/sheet.dart';
import '../../ui/thumb.dart';
import '../../ui/toggle.dart';
import '../../utils/format.dart';
import 'components/playback_options.dart';
import 'components/seek_track.dart';
import 'player_session.dart';
import '../../api/http.dart';

const _ink = Color(0xFFE9E9ED);
const _panel = 360.0;
const _pad = 24.0;
const _bar = 60.0;
// A tap waits this long for a second one (a double tap seeks) on either side of the video
const _doubleTap = Duration(milliseconds: 300);
// More taps on the same side this soon keep seeking
const _seekStreak = Duration(milliseconds: 700);

/// The player (design 1k portrait, 1l sideways or full screen, 1m tablet): the video with its controls (they hide
/// while it plays), the seek bar with moments, and around it the video's title, marks, moments and Up next.
class PlayerScreen extends StatefulWidget {
  const PlayerScreen({
    super.key,
    required this.client,
    required this.personal,
    required this.video,
    required this.upNext,
    required this.onPlayNext,
    required this.onClose,
    this.startAt,
    this.crumb = 'Library',
  });

  final CoveClient client;
  final PersonalStore personal;
  final Video video;
  final List<Video> upNext;
  final double? startAt;
  final void Function(Video video, List<Video> upNext) onPlayNext;
  final VoidCallback onClose;

  /// "Library", or "Library › Northern evenings"
  final String crumb;

  @override
  State<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends State<PlayerScreen> {
  late final PlayerSession _session = PlayerSession(
    client: widget.client,
    personal: widget.personal,
    video: widget.video,
    startAt: widget.startAt,
    onEnded: _ended,
  );
  bool _controls = true;
  bool _overControls = false;
  bool _scrubbing = false;
  bool _fullscreen = false;
  // Touch, full screen (1l): the controls locked away; a tap only shows the unlock button for a moment
  bool _locked = false;
  bool _lockHint = false;
  Timer? _lockTimer;
  Timer? _hide;
  int _tab = 0;
  // Double taps: the side, when, how far it went
  Timer? _tapTimer;
  ({bool forward, int seconds, DateTime at})? _streak;
  Timer? _flashTimer;
  List<String> _stats = const [];
  Timer? _statsTimer;
  final _gear = GlobalKey();
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    // The Library's search may have the keyboard up: it would stay over the player
    FocusManager.instance.primaryFocus?.unfocus();
    _session.addListener(_onSession);
    prefs.addListener(_onPrefs);
    _onPrefs();
    _scheduleHide();
  }

  @override
  void dispose() {
    _session.removeListener(_onSession);
    prefs.removeListener(_onPrefs);
    _hide?.cancel();
    _tapTimer?.cancel();
    _flashTimer?.cancel();
    _statsTimer?.cancel();
    _lockTimer?.cancel();
    _focus.dispose();
    _session.dispose();
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    // The screen turns with the device again
    SystemChrome.setPreferredOrientations(const []);
    super.dispose();
  }

  void _ended() {
    final next = widget.upNext;
    if (prefs.autoplay && next.isNotEmpty)
      widget.onPlayNext(next.first, next.sublist(1));
  }

  bool _wasPinned = true;
  void _onSession() {
    final pinned = _pinned;
    if (_wasPinned && !pinned) _scheduleHide();
    if (pinned && !_controls) setState(() => _controls = true);
    _wasPinned = pinned;
  }

  void _onPrefs() {
    _statsTimer?.cancel();
    if (prefs.stats) {
      _statsTimer = Timer.periodic(const Duration(seconds: 1), (_) async {
        final lines = await _session.stats();
        if (mounted) setState(() => _stats = lines);
      });
    } else if (_stats.isNotEmpty) {
      setState(() => _stats = const []);
    }
  }

  /// The controls stay while there is nothing playing to look at: loading, an error, paused, ended, scrubbing.
  bool get _pinned =>
      !_session.loaded ||
      _session.error.isNotEmpty ||
      !_session.playing ||
      _session.ended ||
      _scrubbing;

  void _showControls() {
    if (!_controls) setState(() => _controls = true);
    _scheduleHide();
  }

  void _scheduleHide() {
    _hide?.cancel();
    final after = prefs.hideAfterMs;
    if (after <= 0) return;
    _hide = Timer(Duration(milliseconds: after), () {
      if (!mounted || _pinned || _overControls) return;
      setState(() => _controls = false);
    });
  }

  void _toggleControls() {
    if (_controls && !_pinned) {
      setState(() => _controls = false);
    } else {
      _showControls();
    }
  }

  /// A tap on the video: the middle toggles the controls; either side waits for a second tap (a double tap seeks).
  void _tap(Offset at, double width) {
    if (_locked) {
      setState(() => _lockHint = true);
      _lockTimer?.cancel();
      _lockTimer = Timer(const Duration(milliseconds: 2500), () {
        if (mounted) setState(() => _lockHint = false);
      });
      return;
    }
    final third = at.dx < width / 3 ? -1 : (at.dx > width * 2 / 3 ? 1 : 0);
    if (third == 0) return _toggleControls();
    final streak = _streak;
    final now = DateTime.now();
    final forward = third > 0;
    // In a streak on this side: another step
    if (streak != null &&
        streak.forward == forward &&
        now.difference(streak.at) < _seekStreak) {
      _seek(forward);
      return;
    }
    if (_tapTimer?.isActive ?? false) {
      _tapTimer!.cancel();
      _seek(forward);
      return;
    }
    _tapTimer = Timer(_doubleTap, _toggleControls);
  }

  void _seek(bool forward) {
    final step = prefs.seekStep;
    final streak = _streak;
    final total = streak != null && streak.forward == forward
        ? streak.seconds + step
        : step;
    _session.skip(forward ? step : -step);
    setState(
      () => _streak = (forward: forward, seconds: total, at: DateTime.now()),
    );
    _flashTimer?.cancel();
    _flashTimer = Timer(_seekStreak, () {
      if (mounted) setState(() => _streak = null);
    });
  }

  /// Full screen: the system bars hidden and, on a phone or tablet, the screen turned to the video's shape (a
  /// landscape video sideways, either way round; a portrait one upright). Leaving it, the screen turns with the
  /// device again.
  void _setFullscreen(bool on) {
    setState(() {
      _fullscreen = on;
      if (!on) _unlock();
    });
    SystemChrome.setEnabledSystemUIMode(
      on ? SystemUiMode.immersiveSticky : SystemUiMode.edgeToEdge,
    );
    if (!desktop) {
      final file = widget.video.primaryFile;
      final portrait = (file?.height ?? 0) > (file?.width ?? 0);
      SystemChrome.setPreferredOrientations(
        !on
            ? const []
            : portrait
            ? const [DeviceOrientation.portraitUp]
            : const [
                DeviceOrientation.landscapeLeft,
                DeviceOrientation.landscapeRight,
              ],
      );
    }
    _showControls();
  }

  void _lock() {
    _hide?.cancel();
    setState(() {
      _locked = true;
      _lockHint = false;
      _controls = false;
    });
  }

  void _unlock() {
    _lockTimer?.cancel();
    _locked = false;
    _lockHint = false;
  }

  void _back() {
    if (_fullscreen) {
      _setFullscreen(false);
    } else {
      widget.onClose();
    }
  }

  void _allSettings() {
    _session.player.pause();
    settingsNav.open(SettingsFrom.player);
  }

  /// The Playback options: above the gear on a tablet, a sheet elsewhere.
  void _options(bool large) {
    _showControls();
    if (!large) {
      showPlaybackSheet(context, _session, _allSettings);
      return;
    }
    final box = _gear.currentContext?.findRenderObject() as RenderBox?;
    if (box == null) return;
    showAnchored<void>(
      context,
      anchor: box.localToGlobal(Offset.zero) & box.size,
      above: true,
      width: 360,
      builder: (popover) => PlaybackOptions(
        session: _session,
        onClose: () => Navigator.of(popover).maybePop(),
        onAllSettings: _allSettings,
      ),
    );
  }

  KeyEventResult _key(FocusNode node, KeyEvent e) {
    if (e is! KeyDownEvent) return KeyEventResult.ignored;
    switch (e.logicalKey) {
      case LogicalKeyboardKey.space || LogicalKeyboardKey.keyK:
        _session.playOrPause();
      case LogicalKeyboardKey.arrowLeft || LogicalKeyboardKey.keyJ:
        _session.skip(-prefs.seekStep);
      case LogicalKeyboardKey.arrowRight || LogicalKeyboardKey.keyL:
        _session.skip(prefs.seekStep);
      case LogicalKeyboardKey.keyF:
        _setFullscreen(!_fullscreen);
      case LogicalKeyboardKey.keyM:
        _session.setVolume(_session.volume > 0 ? 0 : 100);
      default:
        return KeyEventResult.ignored;
    }
    _showControls();
    return KeyEventResult.handled;
  }

  @override
  Widget build(BuildContext context) {
    final screen = screenClassOf(context);
    final layout = _fullscreen || screen == ScreenClass.sideways
        ? _Layout.immersive
        : screen == ScreenClass.large
        ? _Layout.tablet
        : _Layout.portrait;
    // The lock is full screen's: out of it, unlocked
    if (layout != _Layout.immersive && _locked) _unlock();
    if (layout == _Layout.immersive &&
        !_fullscreen &&
        screen == ScreenClass.sideways) {
      SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    }
    return BackHandler(
      layer: Layer.player,
      enabled: true,
      onBack: _back,
      child: Focus(
        focusNode: _focus,
        autofocus: true,
        onKeyEvent: _key,
        child: ColoredBox(
          color: layout == _Layout.immersive
              ? const Color(0xFF000000)
              : Nocturne.bg,
          child: ListenableBuilder(
            listenable: Listenable.merge([_session, widget.personal, prefs]),
            builder: (context, _) => switch (layout) {
              _Layout.tablet => _tablet(context),
              _Layout.portrait => _portrait(context),
              _Layout.immersive => _videoArea(_Layout.immersive),
            },
          ),
        ),
      ),
    );
  }

  // --- The video with its controls -----------------------------------------------------------------------------

  Widget _videoArea(_Layout layout) {
    final s = _session;
    final immersive = layout == _Layout.immersive;
    final transport = switch (layout) {
      _Layout.tablet => 76.0,
      _Layout.immersive => 72.0,
      _Layout.portrait => 64.0,
    };
    final moment = momentAt(s.segments, s.clipStart, s.position);
    // Locked: no controls, whatever plays
    final controls = !_locked && (_controls || _pinned);
    return LayoutBuilder(
      builder: (context, box) => MouseRegion(
        onHover: (_) => _showControls(),
        child: Stack(
          fit: StackFit.expand,
          children: [
            Center(
              child: mk.Video(
                controller: s.controller,
                controls: mk.NoVideoControls,
                fill: const Color(0xFF000000),
                wakelock: true,
              ),
            ),
            // Taps: a click pauses on a desktop; a touch toggles the controls, a double tap on a side seeks
            Positioned.fill(
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTapUp: (e) {
                  if (desktop) {
                    _showControls();
                    s.playOrPause();
                  } else {
                    _tap(e.localPosition, box.maxWidth);
                  }
                },
              ),
            ),
            if (_streak case final streak?)
              Positioned(
                top: 0,
                bottom: 0,
                left: streak.forward ? null : 0,
                right: streak.forward ? 0 : null,
                width: box.maxWidth * 0.33,
                child: IgnorePointer(
                  child: ColoredBox(
                    color: const Color(0x14FFFFFF),
                    child: Center(
                      child: Text(
                        streak.forward
                            ? '» ${streak.seconds} s'
                            : '« ${streak.seconds} s',
                        style: inter(18, weight: FontWeight.w600, color: _ink),
                      ),
                    ),
                  ),
                ),
              ),
            if (_locked && _lockHint)
              Positioned(
                left: 16 + MediaQuery.paddingOf(context).left,
                top: 0,
                bottom: 0,
                child: Center(
                  child: Pressable(
                    onPressed: () {
                      setState(_unlock);
                      _showControls();
                    },
                    semanticLabel: 'Unlock',
                    builder: (context, states) => Container(
                      width: 48,
                      height: 48,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: const Color(0x990E0F18),
                        border: Border.all(color: _ink.withValues(alpha: 0.3)),
                      ),
                      child: const Icon(
                        Phosphor.lockSimple,
                        size: 22,
                        color: _ink,
                      ),
                    ),
                  ),
                ),
              ),
            if (_stats.isNotEmpty)
              Positioned(
                top: immersive ? 64 : 12,
                left: 12,
                child: IgnorePointer(
                  child: Container(
                    constraints: BoxConstraints(maxWidth: box.maxWidth * 0.7),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: const Color(0xB80A0B12),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      _stats.join('\n'),
                      style: mono(
                        10.5,
                        color: _ink,
                      ).copyWith(height: 14 / 10.5),
                    ),
                  ),
                ),
              ),
            if (!s.loaded || s.seeking || (s.buffering && s.playing))
              if (s.error.isEmpty)
                const IgnorePointer(
                  child: Center(child: Spinner(color: _ink, size: 32)),
                ),
            if (s.error.isNotEmpty)
              Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(
                    s.error,
                    textAlign: TextAlign.center,
                    style: inter(14, color: Nocturne.danger),
                  ),
                ),
              ),
            // The controls, fading
            Positioned.fill(
              child: IgnorePointer(
                ignoring: !controls,
                child: AnimatedOpacity(
                  opacity: controls ? 1 : 0,
                  duration: const Duration(milliseconds: 250),
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      // Shade, darkest at the bottom edge
                      const Positioned(
                        left: 0,
                        right: 0,
                        bottom: 0,
                        height: 144,
                        child: IgnorePointer(child: _Shade()),
                      ),
                      if (layout != _Layout.tablet)
                        const Positioned(
                          left: 0,
                          right: 0,
                          top: 0,
                          height: 96,
                          child: IgnorePointer(child: _Shade(top: true)),
                        ),
                      if (s.loaded && s.error.isEmpty && !s.seeking)
                        Center(
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            spacing: transport * 0.84,
                            children: [
                              _Round(
                                icon: Phosphor.clockCounterClockwise,
                                size: transport * 0.42,
                                label: 'Back ${prefs.seekStep} seconds',
                                onPressed: () {
                                  s.skip(-prefs.seekStep);
                                  _showControls();
                                },
                              ),
                              _PlayButton(
                                size: transport,
                                playing: s.playing,
                                ended: s.ended,
                                onPressed: () {
                                  s.playOrPause();
                                  _showControls();
                                },
                              ),
                              _Round(
                                icon: Phosphor.clockClockwise,
                                size: transport * 0.42,
                                label: 'Forward ${prefs.seekStep} seconds',
                                onPressed: () {
                                  s.skip(prefs.seekStep);
                                  _showControls();
                                },
                              ),
                            ],
                          ),
                        ),
                      if (layout == _Layout.portrait) _portraitTop(),
                      if (layout == _Layout.immersive) _immersiveTop(),
                      Positioned(
                        left: immersive ? 24 : 20,
                        right: immersive ? 24 : 20,
                        bottom: immersive ? 16 : 12,
                        child: MouseRegion(
                          onEnter: (_) => _overControls = true,
                          onExit: (_) {
                            _overControls = false;
                            _scheduleHide();
                          },
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              if (layout != _Layout.portrait) _track(big: true),
                              _footer(layout, moment),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _track({required bool big}) {
    final s = _session;
    final d = s.duration;
    return SeekTrack(
      big: big,
      position: s.position,
      duration: d,
      buffered: s.buffered,
      markers: [
        if (d > 0)
          for (final seg in s.segments)
            if ((seg.startSec - s.clipStart) / d case final f
                when f >= 0 && f <= 1)
              f,
      ],
      thumbVisible: _controls || _pinned,
      sprite: s.sprite,
      clipStart: s.clipStart,
      frameUrl: (sec) => widget.client.frameUrl(widget.video.id, sec),
      frameHeaders: widget.client.authHeaders,
      momentLabel: (sec) => momentAt(s.segments, s.clipStart, sec)?.label,
      onSeek: (sec) {
        s.seekTo(sec);
        _showControls();
      },
      onScrubbing: (on) {
        setState(() => _scrubbing = on);
        if (!on) _showControls();
      },
    );
  }

  Widget _footer(_Layout layout, Segment? moment) {
    final s = _session;
    final large = layout == _Layout.tablet;
    final time = Text.rich(
      TextSpan(
        children: [
          TextSpan(text: formatDuration(s.position)),
          TextSpan(
            text: '  /  ${formatDuration(s.duration)}',
            style: TextStyle(color: _ink.withValues(alpha: 0.6)),
          ),
          if (moment != null && layout != _Layout.portrait)
            TextSpan(
              text: '  ·  ${moment.label}',
              style: TextStyle(color: _ink.withValues(alpha: 0.6)),
            ),
        ],
      ),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: inter(
        12,
        weight: medium,
        color: _ink,
      ).copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
    );
    return SizedBox(
      height: 36,
      child: Row(
        spacing: 10,
        children: [
          Expanded(child: time),
          if (layout == _Layout.immersive) ...[
            if (s.segments.isNotEmpty)
              _OverPill(
                icon: Phosphor.listBullets,
                label: 'Moments',
                onPressed: _momentsSheet,
              ),
            if (widget.upNext.isNotEmpty)
              _OverPill(
                icon: Phosphor.skipForward,
                label: 'Next',
                onPressed: () => widget.onPlayNext(
                  widget.upNext.first,
                  widget.upNext.sublist(1),
                ),
              ),
          ],
          if (large && desktop) ...[
            _Over(
              icon: s.volume > 0 ? Phosphor.speakerHigh : Phosphor.speakerSlash,
              label: s.volume > 0 ? 'Mute' : 'Unmute',
              onPressed: () => s.setVolume(s.volume > 0 ? 0 : 100),
            ),
            SizedBox(
              width: 110,
              child: _VolumeBar(
                value: s.volume / 100,
                onChanged: (v) => s.setVolume(v * 100),
              ),
            ),
          ],
          if (layout != _Layout.portrait)
            _OverPill(
              label: speedLabel(s.rate),
              onPressed: () {
                const cycle = [1.0, 1.25, 1.5, 2.0, 0.5, 0.75];
                final i = cycle.indexOf(s.rate);
                s.setRate(cycle[(i + 1) % cycle.length]);
                _showControls();
              },
            ),
          if (layout != _Layout.portrait)
            KeyedSubtree(
              key: _gear,
              child: _Over(
                icon: Phosphor.gearSix,
                label: 'Playback',
                onPressed: () => _options(large),
              ),
            ),
          _Over(
            icon: _fullscreen ? Phosphor.cornersIn : Phosphor.cornersOut,
            label: _fullscreen ? 'Leave full screen' : 'Full screen',
            onPressed: () => _setFullscreen(!_fullscreen),
          ),
        ],
      ),
    );
  }

  Widget _portraitTop() => Positioned(
    left: 4,
    right: 4,
    top: 4,
    child: Row(
      children: [
        _Over(
          icon: Phosphor.caretDown,
          label: 'Close the player',
          onPressed: widget.onClose,
        ),
        const Spacer(),
        _Over(
          icon: Phosphor.closedCaptioning,
          label: 'Subtitles',
          onPressed: () => _options(false),
        ),
        _Over(
          icon: Phosphor.gearSix,
          label: 'Playback',
          onPressed: () => _options(false),
        ),
      ],
    ),
  );

  Widget _immersiveTop() {
    final top = MediaQuery.paddingOf(context).top;
    return Positioned(
      left: 12,
      right: 12,
      top: 8 + top,
      child: Row(
        spacing: 6,
        children: [
          _Over(icon: Phosphor.caretLeft, label: 'Back', onPressed: _back),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  videoTitle(widget.video),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: inter(15, weight: medium, color: _ink),
                ),
                Text(
                  widget.crumb,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: inter(12, color: _ink.withValues(alpha: 0.6)),
                ),
              ],
            ),
          ),
          _Over(
            icon: Phosphor.closedCaptioning,
            label: 'Subtitles',
            onPressed: () => _options(false),
          ),
          if (!desktop)
            _Over(
              icon: Phosphor.lockSimpleOpen,
              label: 'Lock the controls',
              onPressed: _lock,
            ),
          _Over(
            icon: Phosphor.gearSix,
            label: 'Playback',
            onPressed: () => _options(false),
          ),
        ],
      ),
    );
  }

  void _momentsSheet() => showSheet<void>(
    context,
    builder: (sheet) => ListView(
      shrinkWrap: true,
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 16),
      children: [
        const SheetHeading('Moments'),
        for (final m in _session.segments)
          _MomentRow(
            client: widget.client,
            video: widget.video,
            segment: m,
            clipStart: _session.clipStart,
            current:
                momentAt(
                  _session.segments,
                  _session.clipStart,
                  _session.position,
                )?.id ==
                m.id,
            onPressed: () {
              Navigator.of(sheet).pop();
              _session.seekTo(m.startSec - _session.clipStart);
              _session.player.play();
            },
          ),
      ],
    ),
  );

  // --- Tablet (1m) ------------------------------------------------------------------------------------------------

  Widget _tablet(BuildContext context) => LayoutBuilder(
    builder: (context, box) {
      final width = box.maxWidth - _panel - 2 * _pad;
      final height = width * 9 / 16;
      final top = MediaQuery.paddingOf(context).top + 12;
      return Stack(
        children: [
          Positioned(
            top: top - 2,
            left: _pad,
            right: _panel + _pad,
            height: 44,
            child: Row(
              spacing: 10,
              children: [
                CoveIconButton(
                  icon: Phosphor.caretLeft,
                  onPressed: widget.onClose,
                  semanticLabel: 'Back to the Library',
                  box: 40,
                  iconSize: 20,
                  outlined: true,
                ),
                Flexible(
                  child: Text(
                    widget.crumb,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: inter(13, color: Nocturne.textAlpha(60)),
                  ),
                ),
              ],
            ),
          ),
          Positioned(
            top: top + _bar - 12,
            left: _pad,
            width: width,
            height: height,
            child: Container(
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(
                color: const Color(0xFF000000),
                borderRadius: BorderRadius.circular(Nocturne.radiusLg),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x8C000000),
                    offset: Offset(0, 6),
                    blurRadius: 18,
                  ),
                ],
              ),
              child: _videoArea(_Layout.tablet),
            ),
          ),
          Positioned(
            top: top + _bar - 12 + height + 16,
            left: _pad,
            width: width,
            bottom: 0,
            child: SingleChildScrollView(
              padding: const EdgeInsets.only(bottom: 24),
              child: _info(large: true),
            ),
          ),
          Positioned(
            top: 0,
            right: 0,
            bottom: 0,
            width: _panel,
            child: _sidePanel(top),
          ),
        ],
      );
    },
  );

  Widget _info({required bool large}) {
    final v = widget.video;
    final personal = widget.personal.of(v);
    final meta = [
      v.studioName,
      resolutionLabel(v),
      if (v.date != null) partialDate(v.date!),
      if (personal != null && personal.playCount > 0)
        'watched ${personal.playCount}×',
      if (personal?.rating case final r? when r > 0) '★ ${stars(r)}',
    ].nonNulls.where((s) => s.isNotEmpty).join(' · ');
    final audio = [
      for (final t in _session.tracks.audio)
        if (t.id != 'auto' && t.id != 'no') t,
    ];
    final pills = Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        _Pill(
          icon: Phosphor.bookmarkSimple,
          on: personal?.savedForLater ?? false,
          label: (personal?.savedForLater ?? false)
              ? 'Saved for later'
              : 'Save for later',
          onPressed: () => widget.personal.toggleSavedForLater(v),
        ),
        if (large)
          _Pill(
            icon: Phosphor.heart,
            on: personal?.favorite ?? false,
            label: 'Favorite',
            onPressed: () => widget.personal.toggleFavorite(v),
          ),
        _Pill(
          icon: Phosphor.arrowCounterClockwise,
          label: 'Start over',
          onPressed: () {
            _session.seekTo(0);
            _session.player.play();
          },
        ),
        if (!large)
          _Pill(
            icon: Phosphor.gauge,
            label: speedLabel(_session.rate),
            onPressed: () => showPlaybackSheet(context, _session, _allSettings),
          ),
        if (audio.length > 1)
          _Pill(
            icon: Phosphor.waveform,
            label: 'Audio',
            onPressed: () => _options(large),
          ),
      ],
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (large)
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            spacing: 16,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: 4,
                  children: [
                    Text(
                      videoTitle(v),
                      style: inter(24, weight: medium, height: 30),
                    ),
                    if (meta.isNotEmpty)
                      Text(
                        meta,
                        style: inter(12.5, color: Nocturne.textAlpha(55)),
                      ),
                  ],
                ),
              ),
              Flexible(
                child: Align(alignment: Alignment.topRight, child: pills),
              ),
            ],
          )
        else ...[
          Text(videoTitle(v), style: inter(21, weight: medium, height: 27)),
          if (meta.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                meta,
                style: inter(12.5, color: Nocturne.textAlpha(55)),
              ),
            ),
          const SizedBox(height: 12),
          pills,
        ],
        if (v.performers.isNotEmpty || v.tags.isNotEmpty) ...[
          const SizedBox(height: 14),
          Wrap(
            runSpacing: 6,
            children: [
              for (final p in v.performers) PersonChip(p.name),
              for (final t in v.tags) TagChip(t.name),
            ],
          ),
        ],
      ],
    );
  }

  Widget _sidePanel(double top) {
    const tabs = ['Moments', 'Up next', 'Details'];
    return ColoredBox(
      color: const Color(0xFF1E202E),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(height: top),
          Container(
            height: 44,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            decoration: BoxDecoration(
              border: Border(bottom: BorderSide(color: Nocturne.divider)),
            ),
            child: Row(
              spacing: 18,
              children: [
                for (final (i, label) in tabs.indexed)
                  Pressable(
                    onPressed: () => setState(() => _tab = i),
                    semanticLabel: label,
                    builder: (context, states) => Container(
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        border: Border(
                          bottom: BorderSide(
                            color: _tab == i
                                ? Nocturne.accent
                                : Nocturne.accentAlpha(0),
                            width: 2,
                          ),
                        ),
                      ),
                      child: Text(
                        label,
                        style: inter(
                          13.5,
                          weight: _tab == i ? medium : FontWeight.w400,
                          color: _tab == i
                              ? Nocturne.accent
                              : Nocturne.textAlpha(
                                  states.highlighted ? 85 : 65,
                                ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          Expanded(
            child: switch (_tab) {
              0 => _momentsTab(),
              1 => _upNextTab(),
              _ => _detailsTab(),
            },
          ),
        ],
      ),
    );
  }

  Widget _momentsTab() {
    final s = _session;
    if (s.segments.isEmpty) return const _Empty('This video has no moments.');
    final current = momentAt(s.segments, s.clipStart, s.position)?.id;
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        for (final m in s.segments)
          _MomentRow(
            client: widget.client,
            video: widget.video,
            segment: m,
            clipStart: s.clipStart,
            current: current == m.id,
            onPressed: () {
              s.seekTo(m.startSec - s.clipStart);
              s.player.play();
            },
          ),
      ],
    );
  }

  Widget _upNextTab() => ListView(
    padding: const EdgeInsets.all(12),
    children: [
      _autoplayRow(),
      if (widget.upNext.isEmpty) const _Empty('Nothing after this video.'),
      for (final (i, v) in widget.upNext.indexed)
        _UpNextRow(
          client: widget.client,
          video: v,
          onPressed: () => widget.onPlayNext(v, widget.upNext.sublist(i + 1)),
        ),
    ],
  );

  Widget _autoplayRow() => Padding(
    padding: const EdgeInsets.fromLTRB(4, 4, 4, 10),
    child: Row(
      children: [
        Expanded(
          child: Text(
            "The Library's order, after this video",
            style: inter(12.5, color: Nocturne.textAlpha(55)),
          ),
        ),
        Text('Autoplay', style: inter(13, color: Nocturne.textAlpha(75))),
        const SizedBox(width: 8),
        Toggle(
          small: true,
          on: prefs.autoplay,
          onChanged: (v) => prefs.autoplay = v,
        ),
      ],
    ),
  );

  Widget _detailsTab() {
    final v = widget.video;
    final p = widget.personal.of(v);
    final file = v.primaryFile;
    final group = v.groups.firstOrNull;
    final rows = [
      (
        'Rating',
        p?.rating != null && p!.rating! > 0
            ? '★ ${stars(p.rating!)}'
            : 'Not rated',
      ),
      ('Date', v.date != null ? partialDate(v.date!) : '—'),
      if (v.studioName != null) ('Studio', v.studioName!),
      if (group != null) ('Group', groupLabel(group)),
      (
        'Watched',
        '${p == null || p.playCount == 0 ? 'Not yet' : '${p.playCount} time${p.playCount == 1 ? '' : 's'}'}'
            '${p != null && p.progress > 0 ? ' · resumes at ${formatDuration(p.progress * (file?.duration ?? 0))}' : ''}',
      ),
      if (file != null)
        (
          'File',
          [
            if (file.width != null) '${file.width}×${file.height}',
            file.videoCodec,
            prefs.hardwareDecoding ? 'HW' : 'SW',
            'mpv',
          ].nonNulls.join(' · '),
        ),
    ];
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        for (final (k, value) in rows)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 7),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 84,
                  child: Text(
                    k,
                    style: inter(13, color: Nocturne.textAlpha(50)),
                  ),
                ),
                Expanded(child: Text(value, style: inter(13.5))),
              ],
            ),
          ),
      ],
    );
  }

  // --- Phone, upright (1k) --------------------------------------------------------------------------------------

  Widget _portrait(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top;
    final s = _session;
    final current = momentAt(s.segments, s.clipStart, s.position)?.id;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(height: top, color: const Color(0xFF000000)),
        AspectRatio(aspectRatio: 16 / 9, child: _videoArea(_Layout.portrait)),
        // The progress bar, flush under the video; it moves while the controls are hidden
        Transform.translate(
          offset: const Offset(0, -16),
          child: SizedBox(height: 32, child: _track(big: false)),
        ),
        Expanded(
          child: ListView(
            padding: EdgeInsets.fromLTRB(
              16,
              0,
              16,
              24 + MediaQuery.paddingOf(context).bottom,
            ),
            children: [
              _info(large: false),
              if (s.segments.isNotEmpty) ...[
                const SizedBox(height: 20),
                _SectionTitle('Moments'),
                SizedBox(
                  height: 108,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    children: [
                      for (final m in s.segments)
                        _MomentTile(
                          client: widget.client,
                          video: widget.video,
                          segment: m,
                          clipStart: s.clipStart,
                          current: current == m.id,
                          onPressed: () {
                            s.seekTo(m.startSec - s.clipStart);
                            s.player.play();
                          },
                        ),
                    ],
                  ),
                ),
              ],
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 16),
                child: Rule(),
              ),
              Row(
                children: [
                  Expanded(child: _SectionTitle('Up next')),
                  Text(
                    'Autoplay',
                    style: inter(13, color: Nocturne.textAlpha(75)),
                  ),
                  const SizedBox(width: 8),
                  Toggle(
                    small: true,
                    on: prefs.autoplay,
                    onChanged: (v) => prefs.autoplay = v,
                  ),
                ],
              ),
              if (widget.upNext.isEmpty)
                const _Empty('Nothing after this video.'),
              for (final (i, v) in widget.upNext.indexed)
                _UpNextRow(
                  client: widget.client,
                  video: v,
                  onPressed: () =>
                      widget.onPlayNext(v, widget.upNext.sublist(i + 1)),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

enum _Layout { tablet, portrait, immersive }

class _Shade extends StatelessWidget {
  const _Shade({this.top = false});

  final bool top;

  @override
  Widget build(BuildContext context) {
    // rgba(10,11,18, .64·(1−i/8)^1.6) over nine stops, darkest at the edge
    final colors = [
      for (var i = 0; i <= 8; i++)
        const Color(0xFF0A0B12)
            .withValues(alpha: 0.64 * math.pow(1 - i / 8, 1.6)),
    ];
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: top ? Alignment.topCenter : Alignment.bottomCenter,
          end: top ? Alignment.bottomCenter : Alignment.topCenter,
          colors: colors,
        ),
      ),
    );
  }
}

/// The round play / pause button over the video: a blurred-dark disc with a light ring.
class _PlayButton extends StatelessWidget {
  const _PlayButton({
    required this.size,
    required this.playing,
    required this.ended,
    required this.onPressed,
  });

  final double size;
  final bool playing;
  final bool ended;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Pressable(
    onPressed: onPressed,
    semanticLabel: ended ? 'Replay' : (playing ? 'Pause' : 'Play'),
    builder: (context, states) => Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: Color(states.highlighted ? 0x8C0E0F18 : 0x730E0F18),
        border: Border.all(color: _ink.withValues(alpha: 0.35)),
      ),
      child: Icon(
        ended
            ? Phosphor.arrowCounterClockwise
            : Phosphor.fill(playing ? Phosphor.pause : Phosphor.play),
        size: size * 0.44,
        color: _ink,
      ),
    ),
  );
}

class _Round extends StatelessWidget {
  const _Round({
    required this.icon,
    required this.size,
    required this.label,
    required this.onPressed,
  });

  final IconData icon;
  final double size;
  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Pressable(
    onPressed: onPressed,
    semanticLabel: label,
    builder: (context, states) => Container(
      width: size + 20,
      height: size + 20,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: states.highlighted ? const Color(0x1AFFFFFF) : null,
      ),
      child: Icon(icon, size: size, color: _ink),
    ),
  );
}

/// An icon over the video (40 px).
class _Over extends StatelessWidget {
  const _Over({
    required this.icon,
    required this.label,
    required this.onPressed,
  });

  final IconData icon;
  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Pressable(
    onPressed: onPressed,
    semanticLabel: label,
    builder: (context, states) => Container(
      width: 40,
      height: 40,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(Nocturne.radiusMd),
        color: states.highlighted || states.pressed
            ? const Color(0x1FFFFFFF)
            : null,
      ),
      child: Icon(icon, size: 20, color: _ink),
    ),
  );
}

/// A pill over the video: the speed, Moments, Next.
class _OverPill extends StatelessWidget {
  const _OverPill({required this.label, required this.onPressed, this.icon});

  final String label;
  final IconData? icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Pressable(
    onPressed: onPressed,
    semanticLabel: label,
    builder: (context, states) => Container(
      height: 32,
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: _ink.withValues(alpha: 0.35)),
        color: states.highlighted ? const Color(0x1AFFFFFF) : null,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        spacing: 6,
        children: [
          if (icon != null) Icon(icon, size: 15, color: _ink),
          Text(label, style: inter(13, color: _ink)),
        ],
      ),
    ),
  );
}

class _VolumeBar extends StatelessWidget {
  const _VolumeBar({required this.value, required this.onChanged});

  final double value;
  final ValueChanged<double> onChanged;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, box) {
      void set(Offset at) => onChanged((at.dx / box.maxWidth).clamp(0.0, 1.0));
      return GestureDetector(
        onTapDown: (e) => set(e.localPosition),
        onHorizontalDragUpdate: (e) => set(e.localPosition),
        child: Container(
          height: 24,
          alignment: Alignment.centerLeft,
          child: Stack(
            children: [
              Container(
                height: 4,
                decoration: BoxDecoration(
                  color: _ink.withValues(alpha: 0.22),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              FractionallySizedBox(
                widthFactor: value.clamp(0.0, 1.0),
                child: Container(
                  height: 4,
                  decoration: BoxDecoration(
                    color: Nocturne.accent,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    },
  );
}

/// A pill under the video: Save for later, Favorite, Start over (on: the filled icon, accent).
class _Pill extends StatelessWidget {
  const _Pill({
    required this.icon,
    required this.label,
    required this.onPressed,
    this.on = false,
  });

  final IconData icon;
  final String label;
  final bool on;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Pressable(
    onPressed: onPressed,
    semanticLabel: label,
    builder: (context, states) => Container(
      height: 36,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: on ? Nocturne.accent : Nocturne.divider),
        color: on
            ? Nocturne.accentAlpha(12)
            : (states.highlighted ? Nocturne.textAlpha(6) : null),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        spacing: 6,
        children: [
          Icon(
            on ? Phosphor.fill(icon) : icon,
            size: 15,
            color: on ? Nocturne.accent : Nocturne.textAlpha(80),
          ),
          Text(
            label,
            style: inter(13, color: on ? Nocturne.accent200 : Nocturne.text),
          ),
        ],
      ),
    ),
  );
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Text(text, style: inter(15, weight: medium)),
  );
}

class _Empty extends StatelessWidget {
  const _Empty(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(16),
    child: Text(text, style: inter(13, color: Nocturne.textAlpha(55))),
  );
}

/// A moment in the side panel: a frame (120×67), its name and when; the current one highlighted.
class _MomentRow extends StatelessWidget {
  const _MomentRow({
    required this.client,
    required this.video,
    required this.segment,
    required this.clipStart,
    required this.current,
    required this.onPressed,
  });

  final CoveClient client;
  final Video video;
  final Segment segment;
  final double clipStart;
  final bool current;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Pressable(
    onPressed: onPressed,
    semanticLabel: segment.label,
    builder: (context, states) => Container(
      margin: const EdgeInsets.only(bottom: 4),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(Nocturne.radiusMd),
        color: current
            ? Nocturne.accentAlpha(10)
            : (states.highlighted ? Nocturne.textAlpha(5) : null),
        border: Border.all(
          color: current ? Nocturne.accent : Nocturne.accentAlpha(0),
        ),
      ),
      child: Row(
        spacing: 12,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: Image(
              image: coveImage(
                client.frameUrl(video.id, segment.startSec),
                client.authHeaders,
              ),
              width: 120,
              height: 67,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) =>
                  Container(width: 120, height: 67, color: Nocturne.bg),
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              spacing: 4,
              children: [
                Text(
                  segment.label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: inter(14, weight: medium),
                ),
                Text(
                  formatDuration(segment.startSec - clipStart),
                  style: inter(12.5, color: Nocturne.accent300).copyWith(
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}

/// A moment on the phone's rail: a 128 px frame with its time; the current one ringed.
class _MomentTile extends StatelessWidget {
  const _MomentTile({
    required this.client,
    required this.video,
    required this.segment,
    required this.clipStart,
    required this.current,
    required this.onPressed,
  });

  final CoveClient client;
  final Video video;
  final Segment segment;
  final double clipStart;
  final bool current;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Pressable(
    onPressed: onPressed,
    semanticLabel: segment.label,
    builder: (context, states) => Container(
      width: 128,
      margin: const EdgeInsets.only(right: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: 6,
        children: [
          Container(
            width: 128,
            height: 72,
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(Nocturne.radiusMd),
              border: Border.all(
                color: current ? Nocturne.accent : Nocturne.accentAlpha(0),
                width: 2,
              ),
            ),
            child: Stack(
              fit: StackFit.expand,
              children: [
                Image(
                  image: coveImage(
                    client.frameUrl(video.id, segment.startSec),
                    client.authHeaders,
                  ),
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) =>
                      const ColoredBox(color: Nocturne.surface),
                ),
                ThumbBadge(formatDuration(segment.startSec - clipStart)),
              ],
            ),
          ),
          Text(
            segment.label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: inter(
              12.5,
              color: current ? Nocturne.accent300 : Nocturne.text,
            ),
          ),
        ],
      ),
    ),
  );
}

class _UpNextRow extends StatelessWidget {
  const _UpNextRow({
    required this.client,
    required this.video,
    required this.onPressed,
  });

  final CoveClient client;
  final Video video;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Pressable(
    onPressed: onPressed,
    semanticLabel: videoTitle(video),
    builder: (context, states) => Container(
      margin: const EdgeInsets.only(bottom: 4),
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(Nocturne.radiusMd),
        color: states.highlighted || states.pressed
            ? Nocturne.textAlpha(5)
            : null,
      ),
      child: Row(
        spacing: 12,
        children: [
          Container(
            width: 120,
            height: 68,
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(
              color: Nocturne.surface,
              borderRadius: BorderRadius.circular(6),
            ),
            child: Stack(
              fit: StackFit.expand,
              children: [
                Image(
                  image: coveImage(
                    client.imageUrl(video, max: 320),
                    client.authHeaders,
                  ),
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => const SizedBox.shrink(),
                ),
                ThumbBadge(formatDuration(video.primaryFile?.duration)),
              ],
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              spacing: 3,
              children: [
                Text(
                  videoTitle(video),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: inter(14, weight: medium),
                ),
                if (video.studioName != null)
                  Text(
                    video.studioName!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: inter(12, color: Nocturne.textAlpha(55)),
                  ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}
