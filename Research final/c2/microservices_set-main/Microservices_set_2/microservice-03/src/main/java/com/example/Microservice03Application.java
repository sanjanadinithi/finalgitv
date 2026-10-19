package com.example;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import org.springframework.context.annotation.Bean;

import java.io.IOException;
import java.lang.management.ManagementFactory;
import com.sun.management.OperatingSystemMXBean;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

@SpringBootApplication
@RestController
public class Microservice03Application {

    private final AtomicLong incomingRequests = new AtomicLong(0);
    private final AtomicLong processingRequests = new AtomicLong(0);
    private final AtomicLong httpErrors = new AtomicLong(0);
    private final AtomicLong httpErrorsPerSec = new AtomicLong(0);
    private volatile double lastLatencyMs = 0.0;
    private final long startTimeMs = System.currentTimeMillis();

    private final String serviceName = System.getenv().getOrDefault("SERVICE_NAME", "service-java-03");
    private final String platform = System.getenv().getOrDefault("PLATFORM", "render");

    public Microservice03Application() {
        Thread t = new Thread(() -> {
            while (true) {
                try { Thread.sleep(1000); } catch (InterruptedException e) { return; }
                httpErrorsPerSec.set(httpErrors.getAndSet(0));
            }
        });
        t.setDaemon(true);
        t.start();
    }

    public static void main(String[] args) {
        SpringApplication.run(Microservice03Application.class, args);
    }

    @Bean
    public Filter requestCountingFilter() {
        return (ServletRequest request, ServletResponse response, FilterChain chain) -> {
            incomingRequests.incrementAndGet();
            long t0 = System.nanoTime();
            try {
                chain.doFilter(request, response);
            } finally {
                processingRequests.incrementAndGet();
                lastLatencyMs = (System.nanoTime() - t0) / 1_000_000.0;
                if (response instanceof jakarta.servlet.http.HttpServletResponse hr) {
                    if (hr.getStatus() >= 400) httpErrors.incrementAndGet();
                }
            }
        };
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        Map<String, Object> res = new HashMap<>();
        res.put("status", "ok");
        res.put("service", serviceName);
        res.put("service_id", serviceName);
        res.put("platform", platform);
        res.put("target_reachable", true);
        res.put("health_check_failed", 0);
        res.put("latency_ms", lastLatencyMs);
        res.put("target", "self");
        return res;
    }

    @GetMapping("/")
    public String hello() {
        return "Hello from Microservice 03 (Java Spring Boot)";
    }

    @GetMapping("/ping")
    public Map<String, Object> ping() {
        Map<String, Object> res = new HashMap<>();
        res.put("status", "ok");
        res.put("service", serviceName);
        return res;
    }

    @GetMapping("/spike")
    public Map<String, Object> spike(@RequestParam(defaultValue = "10") int duration) {
        long endTime = System.currentTimeMillis() + (duration * 1000L);
        while (System.currentTimeMillis() < endTime) {
            Math.sqrt(64.0 * 64.0 * 64.0 * 64.0);
        }
        Map<String, Object> res = new HashMap<>();
        res.put("message", "CPU spiked for " + duration + " seconds");
        res.put("service", serviceName);
        return res;
    }

    @GetMapping("/metrics")
    public Map<String, Object> metrics() {
        double cpuUsage = 0.0;
        try {
            OperatingSystemMXBean osBean = ManagementFactory.getPlatformMXBean(OperatingSystemMXBean.class);
            double processCpu = osBean.getProcessCpuLoad();
            if (processCpu >= 0) {
                cpuUsage = Math.round(processCpu * 10000.0) / 100.0;
            } else {
                double systemCpu = osBean.getCpuLoad();
                if (systemCpu >= 0) {
                    cpuUsage = Math.round(systemCpu * 10000.0) / 100.0;
                }
            }
        } catch (Exception e) {
            cpuUsage = 0.0;
        }

        long incoming = incomingRequests.get();
        long processing = processingRequests.get();
        long queueLength = Math.max(0, incoming - processing);

        Map<String, Object> res = new HashMap<>();
        res.put("platform", platform);
        res.put("service", serviceName);
        res.put("timestamp", Instant.now().toString());
        res.put("cpu_usage_percent", cpuUsage);
        res.put("incoming_requests", incoming);
        res.put("processing_requests", processing);
        res.put("queue_length", queueLength);
        res.put("latency_ms", Math.round(lastLatencyMs * 100.0) / 100.0);
        res.put("service_unreachable", 0);
        res.put("health_check_failed", 0);
        res.put("request_timeout", 0);
        res.put("http_errors_per_sec", httpErrorsPerSec.get());
        res.put("error_rate", incoming > 0 ? Math.round(httpErrorsPerSec.get() * 1000000.0 / incoming) / 1000000.0 : 0.0);
        res.put("uptime_seconds", Math.round((System.currentTimeMillis() - startTimeMs) / 1000.0 * 100.0) / 100.0);
        res.put("measurement_method", "application_runtime");
        res.put("cpu_allocation", Runtime.getRuntime().availableProcessors() + "vCPU");
        return res;
    }
}