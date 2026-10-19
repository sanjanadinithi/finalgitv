package com.example

import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import java.time.Instant
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.sqrt

private val incomingRequests = AtomicLong(0)
private val processingRequests = AtomicLong(0)
private val httpErrorsWindow = AtomicLong(0)
private val startTime = System.currentTimeMillis()
@Volatile private var lastLatencyMs = 0.0

fun main() {
    val port = System.getenv("PORT")?.toIntOrNull() ?: 3009
    val serviceName = System.getenv("SERVICE_NAME") ?: "service-kotlin-09"
    val platform = System.getenv("PLATFORM") ?: "render"

    Thread {
        while (true) {
            Thread.sleep(1000)
        }
    }.start()

    embeddedServer(Netty, port = port, host = "0.0.0.0") {
        intercept(ApplicationCallPipeline.Monitoring) {
            incomingRequests.incrementAndGet()
            val t0 = System.nanoTime()
            try {
                proceed()
            } finally {
                processingRequests.incrementAndGet()
                lastLatencyMs = (System.nanoTime() - t0) / 1_000_000.0
                val status = call.response.status()?.value ?: 200
                if (status >= 400) httpErrorsWindow.incrementAndGet()
            }
        }
        routing {
            get("/") {
                call.respondText("Hello from Microservice 09 (Kotlin Ktor)")
            }
            get("/ping") {
                call.respondText("""{"status":"ok","service":"$serviceName"}""", io.ktor.http.ContentType.Application.Json)
            }
            get("/health") {
                call.respondText("""{"status":"ok","service":"$serviceName","service_id":"$serviceName","platform":"$platform","target_reachable":true,"health_check_failed":0,"latency_ms":$lastLatencyMs,"target":"self"}""", io.ktor.http.ContentType.Application.Json)
            }
            get("/metrics") {
                val inc = incomingRequests.get()
                val proc = processingRequests.get()
                val queue = maxOf(0, inc - proc)
                val cpu = 0.0
                call.respondText("""{"platform":"$platform","service":"$serviceName","timestamp":"${Instant.now()}","cpu_usage_percent":$cpu,"incoming_requests":$inc,"processing_requests":$proc,"queue_length":$queue,"latency_ms":$lastLatencyMs,"service_unreachable":0,"health_check_failed":0,"request_timeout":0,"http_errors_per_sec":${httpErrorsWindow.getAndSet(0)},"error_rate":0.0,"uptime_seconds":${(System.currentTimeMillis() - startTime) / 1000.0},"measurement_method":"application_runtime","cpu_allocation":"${Runtime.getRuntime().availableProcessors()}vCPU"}""", io.ktor.http.ContentType.Application.Json)
            }
            get("/spike") {
                val duration = call.request.queryParameters["duration"]?.toLongOrNull() ?: 10L
                val endTime = System.currentTimeMillis() + (duration * 1000L)
                while (System.currentTimeMillis() < endTime) {
                    sqrt(64.0 * 64.0 * 64.0 * 64.0)
                }
                call.respondText("""{"message":"CPU spiked for $duration seconds","service":"$serviceName"}""", io.ktor.http.ContentType.Application.Json)
            }
        }
    }.start(wait = true)
}
