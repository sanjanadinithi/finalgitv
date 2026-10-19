import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  incoming = 0;
  processing = 0;
  errors = 0;
  lastLatencyMs = 0;
  startTime = Date.now();

  getHello(): string {
    return 'Hello from Microservice 19 (TypeScript NestJS)';
  }

  ping(): object {
    return { status: 'ok', service: process.env.SERVICE_NAME || 'service-nestjs-19' };
  }

  health(): object {
    return {
      status: 'ok',
      service: process.env.SERVICE_NAME || 'service-nestjs-19',
      service_id: process.env.SERVICE_NAME || 'service-nestjs-19',
      platform: process.env.PLATFORM || 'render',
      target_reachable: true,
      health_check_failed: 0,
      latency_ms: this.lastLatencyMs,
      target: 'self',
    };
  }

  spike(duration: number): object {
    const end = Date.now() + duration * 1000;
    while (Date.now() < end) {
      Math.sqrt(Math.pow(64, 5));
    }
    return { message: `CPU spiked for ${duration} seconds`, service: process.env.SERVICE_NAME || 'service-nestjs-19' };
  }

  metrics(): object {
    const inc = this.incoming;
    const proc = this.processing;
    return {
      platform: process.env.PLATFORM || 'render',
      service: process.env.SERVICE_NAME || 'service-nestjs-19',
      timestamp: new Date().toISOString(),
      cpu_usage_percent: 0,
      incoming_requests: inc,
      processing_requests: proc,
      queue_length: Math.max(0, inc - proc),
      latency_ms: this.lastLatencyMs,
      service_unreachable: 0,
      health_check_failed: 0,
      request_timeout: 0,
      http_errors_per_sec: this.errors,
      error_rate: inc > 0 ? this.errors / inc : 0,
      uptime_seconds: (Date.now() - this.startTime) / 1000,
      measurement_method: 'application_runtime',
      cpu_allocation: 'unknown',
    };
  }
}
