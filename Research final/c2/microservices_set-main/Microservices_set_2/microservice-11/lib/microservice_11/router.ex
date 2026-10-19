defmodule Microservice11.Router do
  use Plug.Router

  plug :match
  plug :fetch_query_params
  plug :dispatch

  @service_name System.get_env("SERVICE_NAME", "service-elixir-11")
  @platform System.get_env("PLATFORM", "render")

  defp bump(key) do
    case :ets.lookup(:metrics_counters, key) do
      [{^key, v}] -> :ets.insert(:metrics_counters, {key, v + 1})
      _ -> :ets.insert(:metrics_counters, {key, 1})
    end
  end

  defp get_c(key) do
    case :ets.lookup(:metrics_counters, key) do
      [{^key, v}] -> v
      _ -> 0
    end
  end

  get "/" do
    bump(:inc)
    send_resp(conn, 200, "Hello from Microservice 11 (Elixir)")
    bump(:proc)
  end

  get "/ping" do
    bump(:inc)
    send_resp(conn, 200, ~s({"status":"ok","service":"#{@service_name}"}))
    bump(:proc)
  end

  get "/health" do
    bump(:inc)
    send_resp(conn, 200, ~s({"status":"ok","service":"#{@service_name}","service_id":"#{@service_name}","platform":"#{@platform}","target_reachable":true,"health_check_failed":0,"latency_ms":0.0,"target":"self"}))
    bump(:proc)
  end

  get "/spike" do
    bump(:inc)
    duration = case Integer.parse(conn.params["duration"] || "10") do
      {d, _} -> d
      _ -> 10
    end
    end_time = System.monotonic_time(:millisecond) + duration * 1000
    burn(end_time)
    send_resp(conn, 200, ~s({"message":"CPU spiked for #{duration} seconds","service":"#{@service_name}"}))
    bump(:proc)
  end

  get "/metrics" do
    inc = get_c(:inc)
    proc_ = get_c(:proc)
    errs = get_c(:err)
    queue = max(0, inc - proc_)
    body = ~s({"platform":"#{@platform}","service":"#{@service_name}","timestamp":"#{DateTime.utc_now() |> DateTime.to_iso8601()}","cpu_usage_percent":0.0,"incoming_requests":#{inc},"processing_requests":#{proc_},"queue_length":#{queue},"latency_ms":0.0,"service_unreachable":0,"health_check_failed":0,"request_timeout":0,"http_errors_per_sec":#{errs},"error_rate":#{if(inc > 0, do: errs / inc, else: 0.0)},"uptime_seconds":0.0,"measurement_method":"application_runtime","cpu_allocation":"unknown"})
    send_resp(conn, 200, body)
  end

  match _ do
    send_resp(conn, 404, "Not found")
  end

  defp burn(end_time) do
    if System.monotonic_time(:millisecond) < end_time do
      :math.sqrt(64 * 64 * 64 * 64 * 64)
      burn(end_time)
    end
  end
end
