using System.Diagnostics;

var builder = WebApplication.CreateBuilder(args);
var port = Environment.GetEnvironmentVariable("PORT") ?? "3007";
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

var app = builder.Build();
var serviceName = Environment.GetEnvironmentVariable("SERVICE_NAME") ?? "service-csharp-07";
var platform = Environment.GetEnvironmentVariable("PLATFORM") ?? "render";

long incomingRequests = 0;
long processingRequests = 0;
long httpErrors = 0;
long httpErrorsWindow = 0;
double lastLatencyMs = 0;
var startTime = DateTime.UtcNow;

_ = Task.Run(async () =>
{
    while (true)
    {
        await Task.Delay(1000);
        Interlocked.Exchange(ref httpErrorsWindow, Interlocked.Read(ref httpErrors));
        Interlocked.Exchange(ref httpErrors, 0);
    }
});

app.Use(async (context, next) =>
{
    Interlocked.Increment(ref incomingRequests);
    var sw = Stopwatch.StartNew();
    try
    {
        await next();
    }
    finally
    {
        sw.Stop();
        lastLatencyMs = sw.Elapsed.TotalMilliseconds;
        Interlocked.Increment(ref processingRequests);
        if (context.Response.StatusCode >= 400) Interlocked.Increment(ref httpErrors);
    }
});

app.MapGet("/health", () => Results.Ok(new
{
    status = "ok",
    service = serviceName,
    service_id = serviceName,
    platform = platform,
    target_reachable = true,
    health_check_failed = 0,
    latency_ms = lastLatencyMs,
    target = "self"
}));

app.MapGet("/", () => "Hello from Microservice 07 (C# ASP.NET Core)");

app.MapGet("/ping", () => Results.Ok(new { status = "ok", service = serviceName }));

app.MapGet("/spike", (int? duration) =>
{
    int dur = duration ?? 10;
    DateTime endTime = DateTime.UtcNow.AddSeconds(dur);
    while (DateTime.UtcNow < endTime)
    {
        Math.Sqrt(64 * 64 * 64 * 64);
    }
    return Results.Ok(new { message = $"CPU spiked for {dur} seconds", service = serviceName });
});

app.MapGet("/metrics", () =>
{
    long inc = Interlocked.Read(ref incomingRequests);
    long proc = Interlocked.Read(ref processingRequests);
    long queue = Math.Max(0, inc - proc);

    return Results.Ok(new
    {
        platform = platform,
        service = serviceName,
        timestamp = DateTime.UtcNow.ToString("o"),
        cpu_usage_percent = 0.0,
        incoming_requests = inc,
        processing_requests = proc,
        queue_length = queue,
        latency_ms = Math.Round(lastLatencyMs, 2),
        service_unreachable = 0,
        health_check_failed = 0,
        request_timeout = 0,
        http_errors_per_sec = Interlocked.Read(ref httpErrors),
        error_rate = inc > 0 ? Math.Round((double)Interlocked.Read(ref httpErrors) / inc, 6) : 0.0,
        uptime_seconds = Math.Round((DateTime.UtcNow - startTime).TotalSeconds, 2),
        measurement_method = "application_runtime",
        cpu_allocation = $"{Environment.ProcessorCount}vCPU"
    });
});

app.Run();