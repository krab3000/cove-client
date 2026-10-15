// The parts of Cove's REST API this client uses (see Cove's ui/src/api/types.ts and src/Cove.Core/DTOs/DTOs.cs).

import 'package:collection/collection.dart';

typedef Json = Map<String, dynamic>;

double? _double(Object? v) => v is num ? v.toDouble() : null;
int? _int(Object? v) => v is num ? v.toInt() : null;

class VideoFile {
  const VideoFile({
    required this.id,
    required this.basename,
    this.width,
    this.height,
    this.duration,
    this.videoCodec,
  });

  final int id;
  final String basename;
  final int? width;
  final int? height;
  // Seconds
  final double? duration;
  final String? videoCodec;

  factory VideoFile.fromJson(Json json) => VideoFile(
    id: json['id'] as int,
    basename: json['basename'] as String? ?? '',
    width: _int(json['width']),
    height: _int(json['height']),
    duration: _double(json['duration']),
    videoCodec: json['videoCodec'] as String?,
  );
}

/// A tag, a performer or a group a video is in.
class Named {
  const Named(this.id, this.name, {this.videoIndex});

  final int id;
  final String name;
  // A group's: the video's place in it
  final int? videoIndex;

  factory Named.fromJson(Json json) => Named(
    json['id'] as int,
    (json['name'] ?? json['title'] ?? '#${json['id']}') as String,
    videoIndex: _int(json['videoIndex']),
  );
}

class Video {
  const Video({
    required this.id,
    required this.title,
    required this.date,
    required this.studioName,
    required this.createdAt,
    required this.updatedAt,
    required this.files,
    required this.primaryFileId,
    required this.tags,
    required this.performers,
    required this.groups,
    this.parentVideoId,
    this.clipStartSec,
    this.clipEndSec,
  });

  final int id;
  final String? title;
  // A partial date: "2021", "2021-05" or "2021-05-03"
  final String? date;
  final String? studioName;
  final String createdAt;
  final String updatedAt;
  // A clip of another video: it plays the parent's file between these times
  final int? parentVideoId;
  final double? clipStartSec;
  final double? clipEndSec;
  final List<VideoFile> files;
  final int? primaryFileId;
  final List<Named> tags;
  final List<Named> performers;
  final List<Named> groups;

  VideoFile? get primaryFile =>
      files.firstWhereOrNull((f) => f.id == primaryFileId) ?? files.firstOrNull;

  factory Video.fromJson(Json json) {
    List<Named> named(String key) => [
      for (final x in (json[key] as List?) ?? const [])
        Named.fromJson(x as Json),
    ];
    return Video(
      id: json['id'] as int,
      title: json['title'] as String?,
      date: json['date'] as String?,
      studioName: json['studioName'] as String?,
      createdAt: json['createdAt'] as String? ?? '',
      updatedAt: json['updatedAt'] as String? ?? '',
      files: [
        for (final f in (json['files'] as List?) ?? const [])
          VideoFile.fromJson(f as Json),
      ],
      primaryFileId: _int(json['primaryFileId']),
      tags: named('tags'),
      performers: named('performers'),
      groups: named('groups'),
      parentVideoId: _int(json['parentVideoId']),
      clipStartSec: _double(json['clipStartSec']),
      clipEndSec: _double(json['clipEndSec']),
    );
  }
}

/// The signed-in user's own data about a video (engagement/batch); not part of the video itself.
class Engagement {
  const Engagement({
    required this.isFavorite,
    required this.rating,
    required this.resumeTime,
    required this.playCount,
  });

  static const none = Engagement(
    isFavorite: false,
    rating: null,
    resumeTime: 0,
    playCount: 0,
  );

  final bool isFavorite;
  // 0–100
  final int? rating;
  // Seconds
  final double resumeTime;
  final int playCount;

  Engagement copyWith({bool? isFavorite}) => Engagement(
    isFavorite: isFavorite ?? this.isFavorite,
    rating: rating,
    resumeTime: resumeTime,
    playCount: playCount,
  );

  factory Engagement.fromJson(Json json) => Engagement(
    isFavorite: json['isFavorite'] == true,
    rating: _int(json['rating']),
    resumeTime: _double(json['resumeTime']) ?? 0,
    playCount: _int(json['playCount']) ?? 0,
  );
}

/// A segment of a video (Cove's segments; the design calls them moments): a span with a name.
class Segment {
  const Segment({
    required this.id,
    required this.startSec,
    this.title,
    this.tagName,
    this.kind,
    this.endSec,
  });

  final int id;
  final double startSec;
  final String? title;
  final String? tagName;
  final String? kind;
  final double? endSec;

  String get label {
    final t = title?.trim();
    if (t != null && t.isNotEmpty) return t;
    return tagName ?? kind ?? 'Moment';
  }

  factory Segment.fromJson(Json json) => Segment(
    id: json['id'] as int,
    startSec: _double(json['startSec']) ?? 0,
    title: json['title'] as String?,
    tagName: json['tagName'] as String?,
    kind: json['kind'] as String?,
    endSec: _double(json['endSec']),
  );
}

/// What videos/aggregate sums up for a filter.
class Aggregate {
  const Aggregate({
    required this.count,
    required this.duration,
    required this.fileSize,
  });

  final int count;
  // Seconds
  final double duration;
  // Bytes
  final double fileSize;

  factory Aggregate.fromJson(Json json) => Aggregate(
    count: _int(json['count']) ?? 0,
    duration: _double(json['duration']) ?? 0,
    fileSize: _double(json['fileSize']) ?? 0,
  );
}

/// A saved filter (savedfilters, per user), as Cove's web UI writes it: JSON strings of its page state. objectFilter
/// holds flat criteria and the rule tree under "_filterExpression"; uiOptions has displayMode ("grid", "list", ...).
class SavedFilter {
  const SavedFilter({
    required this.id,
    required this.name,
    this.findFilter,
    this.objectFilter,
    this.uiOptions,
  });

  final int id;
  final String name;
  final String? findFilter;
  final String? objectFilter;
  final String? uiOptions;

  factory SavedFilter.fromJson(Json json) => SavedFilter(
    id: json['id'] as int,
    name: json['name'] as String? ?? '',
    findFilter: json['findFilter'] as String?,
    objectFilter: json['objectFilter'] as String?,
    uiOptions: json['uiOptions'] as String?,
  );
}

/// A folder of Cove's library (metadata/library-folders): a library root or a folder under one.
class LibraryFolder {
  const LibraryFolder(this.name, this.path, {required this.hasChildren});

  final String name;
  final String path;
  final bool hasChildren;

  factory LibraryFolder.fromJson(Json json) => LibraryFolder(
    json['name'] as String? ?? '',
    json['path'] as String? ?? '',
    hasChildren: json['hasChildren'] == true,
  );
}

/// A cell of Cove's seek-bar sprite sheet: when (seconds) and where in the sheet.
class SpriteCue {
  const SpriteCue(this.start, this.end, this.x, this.y, this.w, this.h);

  final double start;
  final double end;
  final double x;
  final double y;
  final double w;
  final double h;
}

class SpriteSheet {
  const SpriteSheet(this.url, this.cues, this.width, this.height);

  final String url;
  final List<SpriteCue> cues;
  // The whole sheet
  final double width;
  final double height;
}

class VideoPage {
  const VideoPage(this.items, this.totalCount);

  final List<Video> items;
  final int totalCount;

  factory VideoPage.fromJson(Json json) => VideoPage([
    for (final v in json['items'] as List) Video.fromJson(v as Json),
  ], _int(json['totalCount']) ?? 0);
}
