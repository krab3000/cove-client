import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The Library's three views (design 1f/1g): 2 columns, 3 columns (the default), the list.
enum LibraryView { grid2, grid3, list }

const _key = 'cove/prefs/v1';

/// The device's settings (design turn 7): kept on this device, for every account on it, and never sent to the server.
/// What the design's Settings (7a–7d) expose that applies to a media_kit (libmpv) player.
const prefDefaults = <String, Object>{
  // Playback
  'autoplay': true,
  // Resume where the user left off (unless that was in the first seconds or the last 15)
  'resume': true,
  // Seconds a skip button, or a double tap on either side, jumps
  'seekStep': 10,
  // The player's controls hide after this long without input while playing; 0: never
  'hideAfterMs': 3000,
  // The file's default subtitle track, or none: 'file' | 'off'
  'subtitles': 'file',
  'hardwareDecoding': true,
  // Library & previews
  'libraryView': 'grid3',
  // What a card plays when it previews: the preview clip, or nothing: 'clip' | 'off'
  'previews': 'clip',
  'previewHardware': true,
  // Streaming: mpv's demuxer cache (MB; -1: the player's own), how far it reads ahead (seconds), its TLS check
  'memoryCacheMB': -1,
  'readAheadSec': 20,
  'tlsVerify': false,
  // Diagnostics
  'stats': false,
  // 'warn' | 'info' | 'v'
  'playerLog': 'warn',
};

/// The user's choices that outlive a session: the device's settings, the Library's view, the player's Autoplay.
class Prefs extends ChangeNotifier {
  final _values = Map<String, Object>.of(prefDefaults);
  SharedPreferencesAsync? _storage;
  Timer? _save;

  T get<T extends Object>(String key) => _values[key] as T;

  void set(String key, Object value) {
    if (_values[key] == value) return;
    _values[key] = value;
    notifyListeners();
    _save?.cancel();
    _save = Timer(const Duration(milliseconds: 500), () {
      _storage?.setString(_key, jsonEncode(_values)).catchError((_) {});
    });
  }

  /// Settings → Reset to defaults.
  void reset() {
    _values
      ..clear()
      ..addAll(prefDefaults);
    notifyListeners();
    _storage?.setString(_key, jsonEncode(_values)).catchError((_) {});
  }

  bool get autoplay => get('autoplay');
  set autoplay(bool v) => set('autoplay', v);
  bool get resume => get('resume');
  int get seekStep => get('seekStep');
  int get hideAfterMs => get('hideAfterMs');
  bool get subtitlesOff => get<String>('subtitles') == 'off';
  bool get hardwareDecoding => get('hardwareDecoding');
  set hardwareDecoding(bool v) => set('hardwareDecoding', v);
  bool get previews => get<String>('previews') == 'clip';
  bool get previewHardware => get('previewHardware');
  int get memoryCacheMB => get('memoryCacheMB');
  int get readAheadSec => get('readAheadSec');
  bool get tlsVerify => get('tlsVerify');
  bool get stats => get('stats');
  set stats(bool v) => set('stats', v);
  String get playerLog => get('playerLog');

  LibraryView get libraryView => LibraryView.values.firstWhere(
    (v) => v.name == get<String>('libraryView'),
    orElse: () => LibraryView.grid3,
  );
  set libraryView(LibraryView view) => set('libraryView', view.name);

  /// Reads what was kept (only known keys, of the default's type), then keeps every change.
  Future<void> hydrate() async {
    final storage = SharedPreferencesAsync();
    try {
      final json = await storage.getString(_key);
      if (json != null) {
        final kept = jsonDecode(json) as Map<String, dynamic>;
        for (final MapEntry(:key, :value) in prefDefaults.entries) {
          final v = kept[key];
          if (v != null && v.runtimeType == value.runtimeType) {
            _values[key] = v as Object;
          }
        }
        notifyListeners();
      }
    } catch (_) {}
    _storage = storage;
  }
}

final prefs = Prefs();
