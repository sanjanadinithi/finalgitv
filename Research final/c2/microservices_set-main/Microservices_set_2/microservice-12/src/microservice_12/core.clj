(ns microservice-12.core
  (:require [ring.adapter.jetty :refer [run-jetty]]
            [clojure.string :as str]))

(def service-name (get (System/getenv) "SERVICE_NAME" "service-clojure-12"))
(def platform (get (System/getenv) "PLATFORM" "render"))
(def counters (atom {:inc 0 :proc 0 :err 0}))
(def last-latency (atom 0.0))

(defn cpu-burn [seconds]
  (let [end (+ (System/currentTimeMillis) (* seconds 1000))]
    (while (< (System/currentTimeMillis) end)
      (Math/sqrt (* 64 64 64 64 64)))))

(defn metrics-handler [request]
  {:status 200
   :headers {"Content-Type" "application/json"}
   :body (str "{\"platform\":\"" platform "\",\"service\":\"" service-name "\","
              "\"timestamp\":\"" (java.time.Instant/now) "\","
              "\"cpu_usage_percent\":0.0,"
              "\"incoming_requests\":" (:inc @counters) ","
              "\"processing_requests\":" (:proc @counters) ","
              "\"queue_length\":" (max 0 (- (:inc @counters) (:proc @counters))) ","
              "\"latency_ms\":" @last-latency ","
              "\"service_unreachable\":0,\"health_check_failed\":0,\"request_timeout\":0,"
              "\"http_errors_per_sec\":" (:err @counters) ",\"error_rate\":0.0,"
              "\"uptime_seconds\":0.0,\"measurement_method\":\"application_runtime\",\"cpu_allocation\":\"unknown\"}")})

(defn health-handler [request]
  {:status 200
   :headers {"Content-Type" "application/json"}
   :body (str "{\"status\":\"ok\",\"service\":\"" service-name "\",\"service_id\":\"" service-name "\","
              "\"platform\":\"" platform "\",\"target_reachable\":true,\"health_check_failed\":0,"
              "\"latency_ms\":" @last-latency ",\"target\":\"self\"}")})

(defn handler [request]
  (let [t0 (System/nanoTime)]
    (swap! counters update :inc inc)
    (let [uri (:uri request)
          response (cond
                     (= uri "/") {:status 200 :headers {"Content-Type" "text/plain"}
                                  :body "Hello from Microservice 12 (Clojure Ring)"}
                     (= uri "/ping") {:status 200 :headers {"Content-Type" "application/json"}
                                      :body (str "{\"status\":\"ok\",\"service\":\"" service-name "\"}")}
                     (= uri "/health") (health-handler request)
                     (= uri "/metrics") (metrics-handler request)
                     (= uri "/spike") (let [qs (or (:query-string request) "")
                                            m (re-find #"duration=(\d+)" qs)
                                            d (if m (Long/parseLong (second m)) 10)]
                                        (cpu-burn d)
                                        {:status 200 :headers {"Content-Type" "application/json"}
                                         :body (str "{\"message\":\"CPU spiked for " d " seconds\",\"service\":\"" service-name "\"}")})
                     :else {:status 404 :headers {"Content-Type" "text/plain"} :body "Not found"})]
      (reset! last-latency (/ (- (System/nanoTime) t0) 1000000.0))
      (swap! counters update :proc inc)
      (when (>= (:status response) 400) (swap! counters update :err inc))
      response)))

(defn -main []
  (let [port (Integer/parseInt (or (get (System/getenv) "PORT") "3012"))]
    (run-jetty handler {:port port})))
