import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

/// A large screen (tablet, desktop): the shorter side of the window at least this many logical pixels.
const large = 600.0;

bool isLarge(Size size) => size.shortestSide >= large;

/// The screen classes of the design: a tablet or a desktop window (1n, 8f, 1m, 7d), a phone held upright (1a, 8c,
/// 1k, 7a), a phone held sideways (6f, 1l).
enum ScreenClass { large, phone, sideways }

ScreenClass screenClassOf(BuildContext context) {
  final size = MediaQuery.sizeOf(context);
  if (isLarge(size)) return ScreenClass.large;
  return size.width > size.height ? ScreenClass.sideways : ScreenClass.phone;
}

/// A pointer device: hover previews, a mouse over the player. Touch: the card mid-screen previews, taps on the video.
bool get desktop => switch (defaultTargetPlatform) {
  TargetPlatform.macOS ||
  TargetPlatform.windows ||
  TargetPlatform.linux => true,
  _ => false,
};
