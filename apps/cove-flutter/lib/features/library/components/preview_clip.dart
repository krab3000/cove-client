import 'package:flutter/widgets.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart';

import '../../../api/cove_client.dart' hide Video;

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
      controller = VideoController(player);
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
    await player.setVolume(0);
    await player.setPlaylistMode(PlaylistMode.single);
    await player.open(
      Media(
        widget.client.previewUrl(widget.videoId),
        // The session's JWT now (a renewal later doesn't matter: the clip is fetched at once)
        httpHeaders: widget.client.authHeaders,
      ),
    );
    await controller.waitUntilFirstFrameRendered;
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
