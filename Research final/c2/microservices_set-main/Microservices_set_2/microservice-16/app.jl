using HTTP

const incoming = Ref(0)
const processing = Ref(0)
const http_errors = Ref(0)
const errors_window = Ref(0)
const last_latency = Ref(0.0)
const start_t = Ref(time())

function read_cpu()
    try
        a = split(read("/proc/stat", String) |> x -> split(x, "\n") |> first, r"\s+")
        sleep(0.1)
        b = split(read("/proc/stat", String) |> x -> split(x, "\n") |> first, r"\s+")
        pa = parse.(Float64, a[2:end]); pb = parse.(Float64, b[2:end])
        idle = pb[4] - pa[4]; tot = sum(pb) - sum(pa)
        return tot > 0 ? round((1 - idle / tot) * 100, digits=2) : 0.0
    catch
        return 0.0
    end
end

function handler(req::HTTP.Request)
    incoming[] += 1
    t0 = time_ns()
    path = HTTP.uri(req).path
    resp = if path == "/"
        HTTP.Response(200, "Hello from Microservice 16 (Julia HTTP.jl)")
    elseif path == "/ping"
        HTTP.Response(200, "{\"status\":\"ok\",\"service\":\"service-julia-16\"}")
    elseif path == "/health"
        HTTP.Response(200, "{\"status\":\"ok\",\"service\":\"service-julia-16\",\"service_id\":\"service-julia-16\",\"target_reachable\":true,\"health_check_failed\":0,\"latency_ms\":0.0,\"target\":\"self\"}")
    elseif path == "/spike"
        q = HTTP.uri(req).query
        d = 10
        m = match(r"duration=(\d+)", q)
        if m !== nothing; d = parse(Int, m.captures[1]); end
        endt = time() + d
        while time() < endt; sqrt(64.0^5); end
        HTTP.Response(200, "{\"message\":\"CPU spiked for $d seconds\",\"service\":\"service-julia-16\"}")
    elseif path == "/metrics"
        eps = errors_window[]
        errors_window[] = 0
        inc = incoming[]; proc = processing[]
        HTTP.Response(200, "{\"platform\":\"render\",\"service\":\"service-julia-16\",\"cpu_usage_percent\":$(read_cpu()),\"incoming_requests\":$inc,\"processing_requests\":$proc,\"queue_length\":$(max(0, inc - proc)),\"latency_ms\":$(last_latency[]),\"service_unreachable\":0,\"health_check_failed\":0,\"request_timeout\":0,\"http_errors_per_sec\":$eps,\"error_rate\":0.0,\"uptime_seconds\":$(time() - start_t[]),\"measurement_method\":\"application_runtime\",\"cpu_allocation\":\"unknown\"}")
    else
        HTTP.Response(404, "Not found")
    end
    last_latency[] = (time_ns() - t0) / 1e6
    processing[] += 1
    if resp.status >= 400; errors_window[] += 1; end
    return resp
end

port = tryparse(Int, get(ENV, "PORT", "3016"))
HTTP.serve(handler, "0.0.0.0", port === nothing ? 3016 : port)
