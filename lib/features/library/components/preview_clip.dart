import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart';

import '../../../api/cove_client.dart' hide Video;
import '../../../state/prefs.dart';

enum PreviewState { loading, playing, none }

/// Cove's preview clip over a cover (a card hovered, the preview drawer's video): muted and looping, like video
/// sites do, played by media_kit (libmpv). The clip is short and low resolution, so it is cheap to play; it stays
/// invisible until its first frame, so the cover shows until the clip plays. A video without a clip keeps its cover.
class PreviewClip extends StatefulWidget {
  const PreviewClip({
    super.key,
    required this.client,
    required this.videoId,
    this.onState,
  });

  final CoveClient client;
  final int videoId;
  final ValueChanged<PreviewState>? onState;

  @override
  State<PreviewClip> createState() => _PreviewClipState();
}

class _PreviewClipState extends State<PreviewClip> {
  Player? _player;
  VideoController? _controller;
  bool _playing = false;

  @override
  void initState() {
    super.initState();
    _start();
  }

  Future<void> _start() async {
    final has = await widget.client.previewAvailable(widget.videoId);
    if (!mounted) return;
    if (!has) {
      widget.onState?.call(PreviewState.none);
      return;
    }
    final Player player;
    final VideoController controller;
    try {
      player = Player(
        configuration: const PlayerConfiguration(
          // A few seconds of a small clip: no need for a big demuxer cache
          bufferSize: 4 * 1024 * 1024,
          logLevel: MPVLogLevel.error,
        ),
      );
      // Android: the decoder renders straight into the clip's surface (no EGL context per clip; with many clips
      // their EGL calls blocked each other in the GPU driver and froze the app)
      controller = VideoController(
        player,
        configuration: Platform.isAndroid
            ? const VideoControllerConfiguration(
                vo: 'mediacodec_embed',
                hwdec: 'mediacodec',
              )
            : const VideoControllerConfiguration(),
      );
    } catch (_) {
      // No player here (libmpv didn't load): the cover stays
      widget.onState?.call(PreviewState.none);
      return;
    }
    setState(() {
      _player = player;
      _controller = controller;
    });
    player.stream.error.listen((_) {
      if (mounted && !_playing) widget.onState?.call(PreviewState.none);
    });
    // The card may go while this starts (scrolled away, the view switched): its player is disposed then, and
    // anything more asked of it throws
    try {
      await player.setVolume(0);
      if (!mounted) return;
      await player.setPlaylistMode(PlaylistMode.single);
      if (!mounted) return;
      // As the player does (Settings, "Check server certificates"): FFmpeg checks them by default now, and a server
      // with its own CA (trusted by Android, not by mpv) gave no clip
      await (player.platform as NativePlayer).setProperty(
        'tls-verify',
        prefs.tlsVerify ? 'yes' : 'no',
      );
      if (!mounted) return;
      await player.open(
        Media(
          widget.client.previewUrl(widget.videoId),
          // The session's JWT now (a renewal later doesn't matter: the clip is fetched at once)
          httpHeaders: widget.client.authHeaders,
        ),
      );
      if (!mounted) return;
      await controller.waitUntilFirstFrameRendered;
    } catch (_) {
      return;
    }
    if (!mounted) return;
    setState(() => _playing = true);
    widget.onState?.call(PreviewState.playing);
  }

  @override
  void dispose() {
    _player?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    if (controller == null) return const SizedBox.shrink();
    return IgnorePointer(
      child: Opacity(
        opacity: _playing ? 1 : 0,
        child: Video(
          controller: controller,
          controls: NoVideoControls,
          fit: BoxFit.cover,
          fill: const Color(0x00000000),
          wakelock: false,
        ),
      ),
    );
  }
}
