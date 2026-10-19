"""Synthetic sidecar server for testing Component 1 without Azure."""

import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class SyntheticSidecarHandler(BaseHTTPRequestHandler):
    request_count = 0
    stack = "python"
    failure = "mixed"
    name = "payment-service"

    def log_message(self, format_string, *args):
        return

    def do_GET(self):
        if self.path == "/ping":
            self._send_json({"status": "ok", "synthetic": True, "language": self.stack})
            return

        if self.path == "/metrics":
            type(self).request_count += 1
            self._send_json(self._metrics(type(self).request_count))
            return

        self.send_response(404)
        self.end_headers()

    def _metrics(self, count):
        cpu = 20.0
        memory = 35.0 + min(count * 0.3, 25.0)
        heap = 256.0 + count * 3.0
        gc_count = count // 5
        log_message = f"INFO: {self.stack} service request {count} completed."

        if self.failure == "memory_leak":
            memory = min(95.0, 45.0 + count * 4.0)
            heap = 512.0 + count * 80.0
            log_message = "WARNING: memory pressure warning: heap allocation high."
        elif self.failure == "oom":
            memory = 96.0
            heap = 4096.0
            log_message = "FATAL: OUT OF MEMORY - heap space exhausted."
        elif self.failure == "gc_overhead":
            gc_count = count * 4
            log_message = "ERROR: garbage collection overhead limit exceeded."
        elif self.failure == "mixed":
            if count % 7 == 0:
                memory = 96.0
                heap = 4096.0
                log_message = "FATAL: OUT OF MEMORY - heap space exhausted."
            elif count % 4 == 0:
                memory = 91.0
                heap = 2800.0
                log_message = "WARNING: memory leak detected; heap growing rapidly."
            elif count % 3 == 0:
                gc_count = count * 3
                log_message = "ERROR: garbage collection overhead limit exceeded."

        return {
            "synthetic": True,
            "service_id": self.name,
            "cpu_percent": round(cpu, 2),
            "memory_percent": round(memory, 2),
            "memory_used_mb": round(heap, 2),
            "gc_count": gc_count,
            "log_message": log_message,
            "language": self.stack,
            "total_requests": count,
        }

    def _send_json(self, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def run(port, stack, failure, name):
    SyntheticSidecarHandler.request_count = 0
    SyntheticSidecarHandler.stack = stack
    SyntheticSidecarHandler.failure = failure
    SyntheticSidecarHandler.name = name
    server = ThreadingHTTPServer(("127.0.0.1", port), SyntheticSidecarHandler)
    print(f"[{name}] {stack} ({failure}) listening on http://127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Synthetic Component 1 sidecar")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--name", default="my-service", help="Logical service name (e.g. payment-service)")
    parser.add_argument("--stack", default="python",
                        choices=("python", "node", "go", "php", "ruby", "java", "dotnet"))
    parser.add_argument("--failure", default="mixed",
                        choices=("normal", "cpu_spike", "memory_leak", "oom", "gc_overhead", "mixed"))
    args = parser.parse_args()
    run(args.port, args.stack, args.failure, args.name)
