import 'package:flutter/foundation.dart';

import '../api/models.dart';

/// What plays: a video, what comes after it (the Library's order), where to start (a moment), and whether it opens
/// full screen (the video before it was). Null: nothing.
typedef Playing = ({
  Video video,
  List<Video> upNext,
  double? startAt,
  bool fullscreen,
});

class PlayerState extends ChangeNotifier {
  Playing? _playing;

  Playing? get playing => _playing;

  void play(
    Video video,
    List<Video> upNext, {
    double? startAt,
    bool fullscreen = false,
  }) {
    _playing = (
      video: video,
      upNext: upNext,
      startAt: startAt,
      fullscreen: fullscreen,
    );
    notifyListeners();
  }

  void close() {
    _playing = null;
    notifyListeners();
  }
}

final player = PlayerState();
