local lapis = require("lapis")

local app = lapis.Application()

local counters = { inc = 0, proc = 0, err = 0 }
local last_latency = 0

local function burn_cpu(end_clock)
  while os.clock() < end_clock do
    math.sqrt(64 ^ 5)
  end
end

local function cpu_percent()
  local ok = os.execute("sleep 0.1")
  return 0.0
end

app:get("/", function(self)
  counters.inc = counters.inc + 1
  local r = "Hello from Microservice 17 (Lua Lapis)"
  counters.proc = counters.proc + 1
  return r
end)

app:get("/ping", function(self)
  counters.inc = counters.inc + 1
  local r = '{"status":"ok","service":"service-lua-17"}'
  counters.proc = counters.proc + 1
  return { json = { status = "ok", service = "service-lua-17" } }
end)

app:get("/health", function(self)
  counters.inc = counters.inc + 1
  counters.proc = counters.proc + 1
  return { json = { status = "ok", service = "service-lua-17", service_id = "service-lua-17", platform = os.getenv("PLATFORM") or "render", target_reachable = true, health_check_failed = 0, latency_ms = last_latency, target = "self" } }
end)

app:get("/metrics", function(self)
  counters.inc = counters.inc + 1
  local queue = math.max(0, counters.inc - counters.proc)
  local m = {
    platform = os.getenv("PLATFORM") or "render",
    service = os.getenv("SERVICE_NAME") or "service-lua-17",
    timestamp = os.date("!%Y-%m-%dT%H:%M:%SZ"),
    cpu_usage_percent = cpu_percent(),
    incoming_requests = counters.inc,
    processing_requests = counters.proc,
    queue_length = queue,
    latency_ms = last_latency,
    service_unreachable = 0, health_check_failed = 0, request_timeout = 0,
    http_errors_per_sec = counters.err,
    error_rate = counters.inc > 0 and (counters.err / counters.inc) or 0,
    uptime_seconds = os.time(),
    measurement_method = "application_runtime",
    cpu_allocation = "unknown"
  }
  counters.proc = counters.proc + 1
  return { json = m }
end)

app:get("/spike", function(self)
  counters.inc = counters.inc + 1
  local duration = tonumber(self.params.duration) or 10
  burn_cpu(os.clock() + duration)
  counters.proc = counters.proc + 1
  return { json = { message = "CPU spiked for " .. duration .. " seconds", service = "service-lua-17" } }
end)

return app
