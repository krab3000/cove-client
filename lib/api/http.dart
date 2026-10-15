import 'dart:io' show Platform;

import 'package:cronet_http/cronet_http.dart';
import 'package:flutter/painting.dart';
import 'package:http/http.dart' as http;
import 'package:http_image_provider/http_image_provider.dart';

/// Every request to Cove (its API, covers, frames, sprite sheets) goes through this client. On Android it is Cronet
/// (Chrome's networking, from Google Play services), which checks certificates with Android's own trust manager, so
/// the app's network security config applies: a home LAN's private CA installed on the device is trusted for its
/// hosts (`res/xml/network_security_config.xml`). Dart's own client trusts only the CAs Android ships. Elsewhere it is
/// Dart's, which trusts the system's CAs (macOS, Windows).
final http.Client coveHttp = Platform.isAndroid
    ? CronetClient.defaultCronetEngine()
    : http.Client();

/// An image from Cove with the session's headers, fetched by [coveHttp]; decoded at [cacheWidth] when given.
ImageProvider coveImage(
  String url,
  Map<String, String>? headers, {
  int? cacheWidth,
}) => ResizeImage.resizeIfNeeded(
  cacheWidth,
  null,
  HttpImageProvider(Uri.parse(url), headers: headers, client: coveHttp),
);

/// A server that answered with a certificate this device doesn't trust (Dart: CERTIFICATE_VERIFY_FAILED; Cronet:
/// ERR_CERT_AUTHORITY_INVALID and the other ERR_CERT_ errors).
bool untrustedCertificate(Object error) =>
    RegExp(r'CERTIFICATE_VERIFY_FAILED|ERR_CERT_').hasMatch(error.toString());
