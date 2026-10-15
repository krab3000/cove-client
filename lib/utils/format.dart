import '../api/models.dart';

/// "3 days ago", "5 min ago": how long since a time.
String ago(DateTime time) {
  final minutes = (DateTime.now().difference(time).inSeconds / 60).round();
  if (minutes < 1) return 'just now';
  if (minutes < 60) return '$minutes min ago';
  final hours = (minutes / 60).round();
  if (hours < 24) return '$hours h ago';
  final days = (hours / 24).round();
  return days == 1 ? 'yesterday' : '$days days ago';
}

/// "maya" -> "M": an account's avatar.
String initialOf(String name) =>
    name.isEmpty ? '?' : String.fromCharCode(name.runes.first).toUpperCase();

/// 75 -> "1:15", 3725 -> "1:02:05"
String formatDuration(double? seconds) {
  if (seconds == null || !seconds.isFinite || seconds < 0) return '';
  final s = seconds.floor();
  final h = s ~/ 3600, m = (s % 3600) ~/ 60;
  final ss = (s % 60).toString().padLeft(2, '0');
  return h > 0 ? '$h:${m.toString().padLeft(2, '0')}:$ss' : '$m:$ss';
}

/// The usual name of a resolution: its shorter side, "4K" for 2160 and up.
String resolutionLabel(Video video) {
  final file = video.primaryFile;
  final w = file?.width, h = file?.height;
  if (w == null || h == null || w == 0 || h == 0) return '';
  final lines = w < h ? w : h;
  if (lines >= 2100) return lines >= 4300 ? '8K' : '4K';
  return '${lines}p';
}

/// "resolution · duration": the badge over a cover.
String badgeText(Video video) => [
  resolutionLabel(video),
  formatDuration(video.primaryFile?.duration),
].where((s) => s.isNotEmpty).join(' · ');

String videoTitle(Video video) {
  final title = video.title?.trim();
  if (title != null && title.isNotEmpty) return title;
  final name = video.primaryFile?.basename ?? 'Video ${video.id}';
  return name.replaceFirst(RegExp(r'\.[^.]+$'), ''); // without the extension
}

/// "studio · date" (the date added when the video has none).
String videoSubtitle(Video video) {
  final date =
      video.date ??
      (video.createdAt.length >= 10 ? video.createdAt.substring(0, 10) : null);
  return [video.studioName, date].nonNulls.join(' · ');
}

const months = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', //
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/// Cove's partial dates as people write them: "1962", "Oct 2022", "Jun 12, 2024".
String partialDate(String date) {
  final parts = date.split('-');
  if (parts.length < 2) return parts.first;
  final m = int.tryParse(parts[1]);
  final month = m != null && m >= 1 && m <= 12 ? months[m - 1] : parts[1];
  return parts.length > 2
      ? '$month ${int.tryParse(parts[2]) ?? parts[2]}, ${parts[0]}'
      : '$month ${parts[0]}';
}

/// Cove's rating (0–100) as stars out of 5, in halves: 90 -> "4.5".
String stars(int rating) => ((rating / 10).round() / 2).toStringAsFixed(1);

/// "studio · date · watched N×" (or "unwatched", once the play count is known).
String videoMeta(Video video, int? playCount) => [
  video.studioName,
  if (video.date != null) partialDate(video.date!),
  if (playCount != null) playCount > 0 ? 'watched $playCount×' : 'unwatched',
].nonNulls.join(' · ');

/// A video's group: "Northern Trips · part 3".
String groupLabel(Named group) => group.videoIndex != null
    ? '${group.name} · part ${group.videoIndex! + 1}'
    : group.name;

/// 945e9 -> "945 GB"
String formatSize(double bytes) {
  if (bytes >= 1e12) return '${(bytes / 1e12).toStringAsFixed(1)} TB';
  if (bytes >= 1e9) return '${(bytes / 1e9).round()} GB';
  return '${(bytes / 1e6).round()} MB';
}

/// 5934 -> "5,934"
String formatCount(int n) =>
    n.toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');

/// "Ines Ravel" -> "IR": a person's avatar.
String initials(String name) => name
    .split(RegExp(r'\s+'))
    .where((w) => w.isNotEmpty)
    .take(2)
    .map((w) => w[0].toUpperCase())
    .join();
