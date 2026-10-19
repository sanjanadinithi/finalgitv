const express = require('express');
const os = require('os');
const app = express();
const port = process.env.PORT || 3001;
const serviceName = process.env.SERVICE_NAME || 'service-node-01';
const platform = process.env.PLATFORM || 'render';

let incomingRequests = 0;
let processingRequests = 0;
let httpErrors = 0;
let requestTimeouts = 0;
let lastLatencyMs = 0.0;
let lastHttpErrorWindow = 0;
const startTime = Date.now();

setInterval(() => { lastHttpErrorWindow = httpErrors; httpErrors = 0; }, 1000);

app.use((req, res, next) => {
    incomingRequests++;
    const reqStart = Date.now();
    res.on('finish', () => {
        processingRequests++;
        lastLatencyMs = Date.now() - reqStart;
        if (res.statusCode >= 400) httpErrors++;
    });
    next();
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: serviceName,
        platform: platform,
        service_id: serviceName,
        target_reachable: true,
        health_check_failed: 0,
        latency_ms: lastLatencyMs,
        target: 'self'
    });
});

app.get('/', (req, res) => {
  res.send('Hello from Microservice 01 (Node.js Express)');
});

app.get('/ping', (req, res) => {
    res.json({ status: 'ok', service: serviceName });
});

app.get('/spike', (req, res) => {
    const duration = parseInt(req.query.duration || '10', 10);
    const endTime = Date.now() + duration * 1000;
    while (Date.now() < endTime) {
        Math.sqrt(64 * 64 * 64 * 64);
    }
    res.json({ message: `CPU spiked for ${duration} seconds`, service: serviceName });
});

let lastProcUsage = process.cpuUsage();
let lastProcHrtime = process.hrtime.bigint();
let lastProcPercent = 0.0;
let lastProcAt = Date.now();
let lastSysIdle = null;
let lastSysTotal = null;
let currentCpuPercent = 0.0;

const fs = require('fs');

function readProcStatCpu() {
  try {
    const line = fs.readFileSync('/proc/stat', 'ascii').split('\n')[0];
    const parts = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = parts[3] + (parts[4] || 0);
    const total = parts.reduce((a, b) => a + b, 0);
    return { idle, total };
  } catch (e) {
    return null;
  }
}

setInterval(() => {
  // Primary: system-wide CPU% from /proc/stat (matches psutil.cpu_percent on Linux)
  const s = readProcStatCpu();
  if (s && lastSysIdle !== null) {
    const idleDiff = s.idle - lastSysIdle;
    const totalDiff = s.total - lastSysTotal;
    if (totalDiff > 0) {
      currentCpuPercent = Math.min(100, Math.max(0, (1 - idleDiff / totalDiff) * 100));
    }
  }
  if (s) { lastSysIdle = s.idle; lastSysTotal = s.total; }
  else {
    // Fallback: this process's CPU over the interval
    const now = Date.now();
    const u = process.cpuUsage();
    const h = process.hrtime.bigint();
    const cpuMicros = (u.user - lastProcUsage.user) + (u.system - lastProcUsage.system);
    const wallMicros = Number(h - lastProcHrtime) / 1000;
    if (wallMicros > 0) {
      lastProcPercent = Math.min(100, (cpuMicros / wallMicros) * 100);
      currentCpuPercent = lastProcPercent;
    }
    lastProcUsage = u; lastProcHrtime = h; lastProcAt = now;
  }
}, 1000);

app.get('/metrics', (req, res) => {
    const queueLength = incomingRequests - processingRequests;
    res.json({
        platform: platform,
        service: serviceName,
        timestamp: new Date().toISOString(),
        cpu_usage_percent: parseFloat(currentCpuPercent.toFixed(2)),
        incoming_requests: incomingRequests,
        processing_requests: processingRequests,
        queue_length: queueLength >= 0 ? queueLength : 0,
        latency_ms: lastLatencyMs,
        service_unreachable: 0,
        health_check_failed: 0,
        request_timeout: requestTimeouts > 0 ? 1 : 0,
        http_errors_per_sec: lastHttpErrorWindow,
        error_rate: incomingRequests > 0 ? parseFloat(((lastHttpErrorWindow) / Math.max(incomingRequests, 1)).toFixed(6)) : 0,
        uptime_seconds: Math.round((Date.now() - startTime) / 1000 * 100) / 100,
        measurement_method: 'application_runtime',
        cpu_allocation: `${os.cpus().length}vCPU`
    });
});

app.listen(port, () => {
  console.log(`Microservice 01 listening on port ${port}`);
});