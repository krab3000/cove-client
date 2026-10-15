import 'package:flutter/foundation.dart';

import '../api/models.dart';

/// What plays: a video, what comes after it (the Library's order), and where to start (a moment). Null: nothing.
typedef Playing = ({Video video, List<Video> upNext, double? startAt});

class PlayerState extends ChangeNotifier {
  Playing? _playing;

  Playing? get playing => _playing;

  void play(Video video, List<Video> upNext, {double? startAt}) {
    _playing = (video: video, upNext: upNext, startAt: startAt);
    notifyListeners();
  }

  void close() {
    _playing = null;
    notifyListeners();
  }
}

final player = PlayerState();
