import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'sign_in.dart';

const _key = 'cove/accounts/v1';

/// The servers added and the accounts (sessions) kept for them on this device; persisted on every change.
class Accounts extends ChangeNotifier {
  SignIn _state = SignIn.empty;
  SharedPreferencesAsync? _storage;

  SignIn get state => _state;

  /// A change as a pure function of the state (the sign_in.dart helpers); the store takes the result.
  void change(SignIn Function(SignIn state) change) {
    _state = change(_state);
    notifyListeners();
    // At once, not debounced: a refresh token that rotated must survive the app being quit
    _storage?.setString(_key, jsonEncode(_state.toJson()));
  }

  /// Reads what was kept, then writes every change straight away.
  Future<void> hydrate() async {
    final storage = SharedPreferencesAsync();
    try {
      final json = await storage.getString(_key);
      if (json != null) {
        _state = SignIn.fromJson(jsonDecode(json) as Map<String, dynamic>);
        notifyListeners();
      }
    } catch (_) {}
    _storage = storage;
  }
}

final accounts = Accounts();
