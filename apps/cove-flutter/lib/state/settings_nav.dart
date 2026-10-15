import 'package:flutter/foundation.dart';

/// Where Settings was opened from: its Back says where it goes back to.
enum SettingsFrom {
  signIn('Servers'),
  library('Library'),
  player('Player');

  const SettingsFrom(this.backLabel);
  final String backLabel;
}

/// Settings, over everything: open or not, from where, and the section a tablet shows (kept between opens).
class SettingsNav extends ChangeNotifier {
  bool _open = false;
  SettingsFrom _from = SettingsFrom.library;
  int section = 0;

  bool get isOpen => _open;
  SettingsFrom get from => _from;

  void open(SettingsFrom from) {
    _open = true;
    _from = from;
    notifyListeners();
  }

  void close() {
    _open = false;
    notifyListeners();
  }

  void show(int index) {
    section = index;
    notifyListeners();
  }
}

final settingsNav = SettingsNav();
