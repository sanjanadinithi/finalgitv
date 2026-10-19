import 'dart:io';
import 'package:shelf/shelf.dart';
import 'package:shelf/shelf_io.dart';
import 'package:shelf_router/shelf_router.dart';

int incoming = 0;
int processing = 0;
int errors = 0;
double lastLatency = 0.0;
final stopwatch = Stopwatch()..start();

Response _hello(Request request) => Response.ok('Hello from Microservice 14 (Dart Shelf)');

Response _ping(Request request) => Response.ok(
    '{"status":"ok","service":"service-dart-14"}',
    headers: {'content-type': 'application/json'});

Response _health(Request request) => Response.ok(
    '{"status":"ok","service":"service-dart-14","service_id":"service-dart-14","target_reachable":true,"health_check_failed":0,"latency_ms":$lastLatency,"target":"self"}',
    headers: {'content-type': 'application/json'});

Response _metrics(Request request) {
  final proc = processing;
  final inc = incoming;
  final body = '''{"platform":"render","service":"service-dart-14","cpu_usage_percent":0.0,"incoming_requests":$inc,"processing_requests":$proc,"queue_length":${inc > proc ? inc - proc : 0},"latency_ms":$lastLatency,"service_unreachable":0,"health_check_failed":0,"request_timeout":0,"http_errors_per_sec":$errors,"error_rate":${inc > 0 ? errors / inc : 0.0},"uptime_seconds":${stopwatch.elapsedMilliseconds / 1000.0},"measurement_method":"application_runtime","cpu_allocation":"unknown"}''';
  return Response.ok(body, headers: {'content-type': 'application/json'});
}

Response _spike(Request request) {
  final d = int.tryParse(request.url.queryParameters['duration'] ?? '10') ?? 10;
  final sw = Stopwatch()..start();
  while (sw.elapsed < Duration(seconds: d)) {
    sw.elapsed;
  }
  sw.stop();
  return Response.ok('{"message":"CPU spiked for $d seconds","service":"service-dart-14"}',
      headers: {'content-type': 'application/json'});
}

void main(List<String> args) async {
  final router = Router()
    ..get('/', _hello)
    ..get('/ping', _ping)
    ..get('/health', _health)
    ..get('/metrics', _metrics)
    ..get('/spike', _spike);

  Middleware timing = (handler) {
    return (request) async {
      incoming++;
      final sw = Stopwatch()..start();
      var response = await handler(request);
      sw.stop();
      processing++;
      lastLatency = sw.elapsedMicroseconds / 1000.0;
      if (response.statusCode >= 400) errors++;
      return response;
    };
  };

  final handler = Pipeline().addMiddleware(logRequests()).addMiddleware(timing).addHandler(router);

  final port = int.tryParse(Platform.environment['PORT'] ?? '') ?? 3014;
  final server = await serve(handler, InternetAddress.anyIPv4, port);

  print('Server listening on port ${server.port}');
}
