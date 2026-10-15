import 'package:flutter/foundation.dart';

import '../api/cove_client.dart';

// An answer is asked again after this long (when it is next looked at)
const _stale = Duration(seconds: 30);

/// Whether each server answers (Cove's status needs no sign-in): null while asking. Looking one up asks the server
/// when there is no answer yet, or only an old one (kept meanwhile).
class Reachability extends ChangeNotifier {
  Reachability({this.onReached});

  /// A server answered (its address): the list says when it was last reached.
  final void Function(String address)? onReached;

  final _answers = <String, ({bool value, DateTime at})>{};
  final _asking = <String>{};
  // Bumped by askAgain: answers to earlier questions are dropped
  int _generation = 0;
  bool _disposed = false;

  bool? of(String address) {
    final answer = _answers[address];
    if (!_asking.contains(address) &&
        (answer == null || DateTime.now().difference(answer.at) > _stale)) {
      _ask(address);
    }
    return answer?.value;
  }

  /// Asks every server again (Try again).
  void askAgain() {
    _generation++;
    _answers.clear();
    _asking.clear();
    notifyListeners();
  }

  Future<void> _ask(String address) async {
    _asking.add(address);
    final generation = _generation;
    final value = await CoveClient.reachable(address);
    if (_disposed || generation != _generation) return;
    _asking.remove(address);
    _answers[address] = (value: value, at: DateTime.now());
    if (value) onReached?.call(address);
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
