# plumber.R

library(plumber)

COUNTERS <- new.env()
COUNTERS$incoming <- 0L
COUNTERS$processing <- 0L
COUNTERS$errors_per_sec <- 0L
COUNTERS$last_latency_ms <- 0.0
COUNTERS$start <- Sys.time()

#* @filter
function(req, res) {
  COUNTERS$incoming <- COUNTERS$incoming + 1L
  t0 <- Sys.time()
  plumber::forward()
  COUNTERS$last_latency_ms <- as.numeric(difftime(Sys.time(), t0, units = "secs")) * 1000
  COUNTERS$processing <- COUNTERS$processing + 1L
  if (res$status >= 400) COUNTERS$errors_per_sec <- COUNTERS$errors_per_sec + 1L
}

#* @get /
function() {
  "Hello from Microservice 15 (R Plumber)"
}

#* @get /ping
function() {
  list(status = "ok", service = Sys.getenv("SERVICE_NAME", "service-r-15"))
}

#* @get /health
function() {
  list(
    status = "ok", service = Sys.getenv("SERVICE_NAME", "service-r-15"),
    service_id = Sys.getenv("SERVICE_NAME", "service-r-15"),
    platform = Sys.getenv("PLATFORM", "render"),
    target_reachable = TRUE, health_check_failed = 0L,
    latency_ms = COUNTERS$last_latency_ms, target = "self"
  )
}

#* @get /spike
function(duration = 10) {
  duration <- as.numeric(duration)
  end <- Sys.time() + duration
  while (Sys.time() < end) {
    sqrt(64 ^ 5)
  }
  list(message = paste0("CPU spiked for ", duration, " seconds"), service = Sys.getenv("SERVICE_NAME", "service-r-15"))
}

#* @get /metrics
function() {
  cpu <- 0.0
  try({
    a <- readLines("/proc/stat", n = 1)
    Sys.sleep(0.1)
    b <- readLines("/proc/stat", n = 1)
    pa <- as.numeric(strsplit(a, "\\s+")[[1]][-1])
    pb <- as.numeric(strsplit(b, "\\s+")[[1]][-1])
    idle_diff <- pb[4] - pa[4]
    total_diff <- sum(pb) - sum(pa)
    if (total_diff > 0) cpu <- round((1 - idle_diff / total_diff) * 100, 2)
  }, silent = TRUE)

  inc <- COUNTERS$incoming
  proc <- COUNTERS$processing
  eps <- COUNTERS$errors_per_sec
  COUNTERS$errors_per_sec <- 0L

  list(
    platform = Sys.getenv("PLATFORM", "render"),
    service = Sys.getenv("SERVICE_NAME", "service-r-15"),
    timestamp = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
    cpu_usage_percent = cpu,
    incoming_requests = inc,
    processing_requests = proc,
    queue_length = max(0, inc - proc),
    latency_ms = COUNTERS$last_latency_ms,
    service_unreachable = 0L, health_check_failed = 0L, request_timeout = 0L,
    http_errors_per_sec = eps,
    error_rate = if (inc > 0) eps / inc else 0,
    uptime_seconds = as.numeric(difftime(Sys.time(), COUNTERS$start, units = "secs")),
    measurement_method = "application_runtime", cpu_allocation = "unknown"
  )
}
