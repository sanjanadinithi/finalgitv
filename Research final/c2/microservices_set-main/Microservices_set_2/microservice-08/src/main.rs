use actix_web::{web, App, HttpResponse, HttpServer, Responder, HttpRequest, middleware::{self, Next}, body::BoxBody, HttpMessage};
use serde::Serialize;
use std::env;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

static INCOMING: AtomicU64 = AtomicU64::new(0);
static PROCESSING: AtomicU64 = AtomicU64::new(0);
static HTTP_ERRORS: AtomicU64 = AtomicU64::new(0);
static LAST_LATENCY_MS: Mutex<f64> = Mutex::new(0.0);
static START: Mutex<Option<Instant>> = Mutex::new(None);

async fn metrics_mw(req: HttpRequest, next: Next<BoxBody>) -> Result<HttpResponse<BoxBody>, actix_web::Error> {
    INCOMING.fetch_add(1, Ordering::SeqCst);
    let start = Instant::now();
    let res = next.call(req).await?;
    PROCESSING.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut l) = LAST_LATENCY_MS.lock() {
        *l = start.elapsed().as_secs_f64() * 1000.0;
    }
    if res.status().as_u16() >= 400 {
        HTTP_ERRORS.fetch_add(1, Ordering::SeqCst);
    }
    Ok(res)
}

async fn health() -> impl Responder {
    let latency = LAST_LATENCY_MS.lock().map(|v| *v).unwrap_or(0.0);
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ok",
        "service": env::var("SERVICE_NAME").unwrap_or_else(|_| "service-rust-08".to_string()),
        "target_reachable": true,
        "health_check_failed": 0,
        "latency_ms": latency,
        "target": "self"
    }))
}

async fn metrics() -> impl Responder {
    let inc = INCOMING.load(Ordering::SeqCst);
    let proc_ = PROCESSING.load(Ordering::SeqCst);
    let errs = HTTP_ERRORS.load(Ordering::SeqCst);
    let latency = LAST_LATENCY_MS.lock().map(|v| *v).unwrap_or(0.0);
    let uptime = START.lock().ok().and_then(|s| s.map(|t| t.elapsed().as_secs_f64())).unwrap_or(0.0);
    let queue = inc.saturating_sub(proc_);
    HttpResponse::Ok().json(serde_json::json!({
        "platform": env::var("PLATFORM").unwrap_or_else(|_| "render".to_string()),
        "service": env::var("SERVICE_NAME").unwrap_or_else(|_| "service-rust-08".to_string()),
        "timestamp": format!("{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()),
        "cpu_usage_percent": 0.0,
        "incoming_requests": inc,
        "processing_requests": proc_,
        "queue_length": queue,
        "latency_ms": latency,
        "service_unreachable": 0,
        "health_check_failed": 0,
        "request_timeout": 0,
        "http_errors_per_sec": errs,
        "error_rate": if inc > 0 { errs as f64 / inc as f64 } else { 0.0 },
        "uptime_seconds": uptime,
        "measurement_method": "application_runtime",
        "cpu_allocation": format!("{}vCPU", std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1)),
    }))
}

#[derive(Serialize)]
struct PingResponse {
    status: String,
    service: String,
}

#[derive(Serialize)]
struct SpikeResponse {
    message: String,
    service: String,
}

#[derive(serde::Deserialize)]
struct SpikeQuery {
    duration: Option<u64>,
}

async fn hello() -> impl Responder {
    HttpResponse::Ok().body("Hello from Microservice 08 (Rust Actix)")
}

async fn ping() -> impl Responder {
    let service_name = env::var("SERVICE_NAME").unwrap_or_else(|_| "service-rust-08".to_string());
    HttpResponse::Ok().json(PingResponse {
        status: "ok".to_string(),
        service: service_name,
    })
}

async fn spike(query: web::Query<SpikeQuery>) -> impl Responder {
    let service_name = env::var("SERVICE_NAME").unwrap_or_else(|_| "service-rust-08".to_string());
    let duration_secs = query.duration.unwrap_or(10);
    let end_time = Instant::now() + Duration::from_secs(duration_secs);

    while Instant::now() < end_time {
        let _ = (64.0f64).sqrt();
    }

    HttpResponse::Ok().json(SpikeResponse {
        message: format!("CPU spiked for {} seconds", duration_secs),
        service: service_name,
    })
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port = env::var("PORT").unwrap_or_else(|_| "3008".to_string());
    let bind_addr = format!("0.0.0.0:{}", port);
    if let Ok(mut s) = START.lock() {
        *s = Some(Instant::now());
    }

    HttpServer::new(|| {
        App::new()
            .wrap(middleware::from_fn(metrics_mw))
            .route("/", web::get().to(hello))
            .route("/ping", web::get().to(ping))
            .route("/spike", web::get().to(spike))
            .route("/health", web::get().to(health))
            .route("/metrics", web::get().to(metrics))
    })
    .bind(&bind_addr)?
    .run()
    .await
}