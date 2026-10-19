package controllers

import javax.inject._
import play.api._
import play.api.mvc._
import play.api.libs.json._
import java.time.Instant
import java.util.concurrent.atomic.AtomicLong

@Singleton
class HomeController @Inject()(val controllerComponents: ControllerComponents) extends BaseController {

  private val serviceName = sys.env.getOrElse("SERVICE_NAME", "service-scala-10")
  private val platform = sys.env.getOrElse("PLATFORM", "render")

  private val incomingRequests = new AtomicLong(0)
  private val processingRequests = new AtomicLong(0)
  private val httpErrorsWindow = new AtomicLong(0)
  private val startTimeMs = System.currentTimeMillis()
  @volatile private var lastLatencyMs = 0.0

  private def timed[A](a: => A)(implicit request: Request[AnyContent]): A = {
    val t0 = System.nanoTime()
    try {
      a
    } finally {
      lastLatencyMs = (System.nanoTime() - t0) / 1000000.0
      processingRequests.incrementAndGet()
    }
  }

  def index() = Action { implicit request: Request[AnyContent] =>
    incomingRequests.incrementAndGet()
    timed {
      Ok("Hello from Microservice 10 (Scala Play)")
    }
  }

  def ping() = Action { implicit request: Request[AnyContent] =>
    incomingRequests.incrementAndGet()
    timed {
      val json = Json.obj(
        "status" -> "ok",
        "service" -> serviceName
      )
      Ok(json)
    }
  }

  def health() = Action { implicit request: Request[AnyContent] =>
    timed {
      Ok(Json.obj(
        "status" -> "ok",
        "service" -> serviceName,
        "service_id" -> serviceName,
        "platform" -> platform,
        "target_reachable" -> true,
        "health_check_failed" -> 0,
        "latency_ms" -> lastLatencyMs,
        "target" -> "self"
      ))
    }
  }

  def spike(duration: Option[Int]) = Action { implicit request: Request[AnyContent] =>
    incomingRequests.incrementAndGet()
    timed {
      val dur = duration.getOrElse(10)
      val endTime = System.currentTimeMillis() + (dur * 1000L)
      while (System.currentTimeMillis() < endTime) {
        scala.math.sqrt(64.0 * 64.0 * 64.0 * 64.0)
      }
      val json = Json.obj(
        "message" -> s"CPU spiked for $dur seconds",
        "service" -> serviceName
      )
      Ok(json)
    }
  }

  def metrics() = Action { implicit request: Request[AnyContent] =>
    val inc = incomingRequests.get()
    val proc = processingRequests.get()
    val queue = math.max(0, inc - proc)

    val json = Json.obj(
      "platform" -> platform,
      "service" -> serviceName,
      "timestamp" -> Instant.now().toString,
      "cpu_usage_percent" -> 0.0,
      "incoming_requests" -> inc,
      "processing_requests" -> proc,
      "queue_length" -> queue,
      "latency_ms" -> lastLatencyMs,
      "service_unreachable" -> 0,
      "health_check_failed" -> 0,
      "request_timeout" -> 0,
      "http_errors_per_sec" -> httpErrorsWindow.getAndSet(0),
      "error_rate" -> (if (inc > 0) httpErrorsWindow.get().toDouble / inc else 0.0),
      "uptime_seconds" -> (System.currentTimeMillis() - startTimeMs) / 1000.0,
      "measurement_method" -> "application_runtime",
      "cpu_allocation" -> s"${Runtime.getRuntime().availableProcessors()}vCPU"
    )
    Ok(json)
  }
}