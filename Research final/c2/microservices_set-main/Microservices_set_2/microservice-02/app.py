import os
import time
import math
import psutil
from datetime import datetime, timezone
from flask import Flask, request, jsonify

app = Flask(__name__)

# Config
PORT = int(os.environ.get('PORT', 3002))
SERVICE_NAME = os.environ.get('SERVICE_NAME', 'service-python-02')
PLATFORM = os.environ.get('PLATFORM', 'render')

incoming_requests = 0
processing_requests = 0
http_errors = 0
request_timeouts = 0
last_latency_ms = 0.0
http_errors_per_sec = 0.0
start_time = time.time()
_last_error_count = 0

import threading
def _error_window():
    global http_errors_per_sec, _last_error_count
    while True:
        http_errors_per_sec = http_errors - _last_error_count
        _last_error_count = http_errors
        time.sleep(1.0)
threading.Thread(target=_error_window, daemon=True).start()

@app.before_request
def before_request():
    global incoming_requests
    incoming_requests += 1
    request._start_time = time.perf_counter()

@app.after_request
def after_request(response):
    global processing_requests, http_errors, last_latency_ms
    processing_requests += 1
    if hasattr(request, '_start_time'):
        last_latency_ms = round((time.perf_counter() - request._start_time) * 1000, 2)
    if response.status_code >= 400:
        http_errors += 1
    return response

@app.route('/health')
def health():
    return jsonify({
        "status": "ok",
        "service": SERVICE_NAME,
        "service_id": SERVICE_NAME,
        "target_reachable": True,
        "health_check_failed": 0,
        "latency_ms": last_latency_ms,
        "target": "self",
        "platform": PLATFORM,
    })

@app.route('/')
def hello():
    return 'Hello from Microservice 02 (Python Flask)'

@app.route('/ping')
def ping():
    return jsonify({"status": "ok", "service": SERVICE_NAME})

@app.route('/spike')
def spike():
    duration = int(request.args.get('duration', 10))
    end_time = time.time() + duration
    while time.time() < end_time:
        math.sqrt(64 ** 5)
    return jsonify({"message": f"CPU spiked for {duration} seconds", "service": SERVICE_NAME})

@app.route('/metrics')
def metrics():
    # Application runtime metrics for Render
    cpu_usage_percent = psutil.cpu_percent(interval=0.1)
    queue_length = max(0, incoming_requests - processing_requests)
    
    return jsonify({
        "platform": PLATFORM,
        "service": SERVICE_NAME,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "cpu_usage_percent": cpu_usage_percent,
        "incoming_requests": incoming_requests,
        "processing_requests": processing_requests,
        "queue_length": queue_length,
        "latency_ms": last_latency_ms,
        "service_unreachable": 0,
        "health_check_failed": 0,
        "request_timeout": 1 if request_timeouts > 0 else 0,
        "http_errors_per_sec": float(http_errors_per_sec),
        "error_rate": round(http_errors_per_sec / max(incoming_requests, 1), 6),
        "uptime_seconds": round(time.time() - start_time, 2),
        "measurement_method": "application_runtime",
        "cpu_allocation": f"{psutil.cpu_count()}vCPU"
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=PORT)