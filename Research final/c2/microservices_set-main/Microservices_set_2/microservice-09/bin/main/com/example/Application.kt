package com.example

import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.response.*
import io.ktor.server.routing.*

fun main() {
    embeddedServer(Netty, port = 3009) {
        routing {
            get("/") {
                call.respondText("Hello from Microservice 09 (Kotlin Ktor)")
            }
        }
    }.start(wait = true)
}