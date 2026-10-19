<?php

use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Factory\AppFactory;

require __DIR__ . '/vendor/autoload.php';

$app = AppFactory::create();

$serviceName = getenv('SERVICE_NAME') ?: 'service-php-06';
$platform = getenv('PLATFORM') ?: 'render';

$state = new stdClass();
$state->incoming = 0;
$state->processing = 0;
$state->errors = 0;
$state->errorsThisWindow = 0;
$state->lastLatency = 0.0;
$state->start = microtime(true);

$app->add(function (Request $request, $handler) use ($state) {
    $state->incoming++;
    $t0 = microtime(true);
    $response = $handler->handle($request);
    $state->lastLatency = round((microtime(true) - $t0) * 1000, 2);
    $state->processing++;
    if ($response->getStatusCode() >= 400) {
        $state->errors++;
        $state->errorsThisWindow++;
    }
    return $response;
});

set_time_limit(0);

$app->get('/', function (Request $request, Response $response, $args) {
    $response->getBody()->write("Hello from Microservice 06 (PHP Slim)");
    return $response;
});

$app->get('/ping', function (Request $request, Response $response, $args) use ($serviceName) {
    $payload = json_encode(['status' => 'ok', 'service' => $serviceName]);
    $response->getBody()->write($payload);
    return $response->withHeader('Content-Type', 'application/json');
});

$app->get('/health', function (Request $request, Response $response, $args) use ($serviceName, $platform, $state) {
    $payload = json_encode([
        'status' => 'ok',
        'service' => $serviceName,
        'service_id' => $serviceName,
        'platform' => $platform,
        'target_reachable' => true,
        'health_check_failed' => 0,
        'latency_ms' => $state->lastLatency,
        'target' => 'self'
    ]);
    $response->getBody()->write($payload);
    return $response->withHeader('Content-Type', 'application/json');
});

$app->get('/metrics', function (Request $request, Response $response, $args) use ($serviceName, $platform, $state) {
    $cpu = 0.0;
    if (function_exists('sys_getloadavg')) {
        $load = sys_getloadavg();
        $cpu = isset($load[0]) ? round(min(100.0, $load[0] * 100.0 / max(1, (int)shell_exec('nproc'))), 2) : 0.0;
    }
    $queue = max(0, $state->incoming - $state->processing);
    $eps = $state->errorsThisWindow;
    $state->errorsThisWindow = 0;
    $payload = json_encode([
        'platform' => $platform,
        'service' => $serviceName,
        'timestamp' => gmdate('c'),
        'cpu_usage_percent' => $cpu,
        'incoming_requests' => $state->incoming,
        'processing_requests' => $state->processing,
        'queue_length' => $queue,
        'latency_ms' => $state->lastLatency,
        'service_unreachable' => 0,
        'health_check_failed' => 0,
        'request_timeout' => 0,
        'http_errors_per_sec' => $eps,
        'error_rate' => $state->incoming > 0 ? round($eps / max($state->incoming, 1), 6) : 0.0,
        'uptime_seconds' => round(microtime(true) - $state->start, 2),
        'measurement_method' => 'application_runtime',
        'cpu_allocation' => 'unknown'
    ]);
    $response->getBody()->write($payload);
    return $response->withHeader('Content-Type', 'application/json');
});

$app->get('/spike', function (Request $request, Response $response, $args) use ($serviceName) {
    $queryParams = $request->getQueryParams();
    $duration = isset($queryParams['duration']) ? (int)$queryParams['duration'] : 10;
    $endTime = microtime(true) + $duration;

    while (microtime(true) < $endTime) {
        sqrt(64 * 64 * 64 * 64);
    }

    $payload = json_encode([
        'message' => "CPU spiked for {$duration} seconds",
        'service' => $serviceName
    ]);
    $response->getBody()->write($payload);
    return $response->withHeader('Content-Type', 'application/json');
});

$app->run();