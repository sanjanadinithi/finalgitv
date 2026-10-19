# Microservice 04 - Go Gin

A production-ready microservice using Go 1.22 and Gin framework, optimized for deployment on Render.

## Features

- Lightweight multi-stage Docker build (~20MB final image)
- Graceful shutdown with SIGTERM/SIGINT handling (15s timeout)
- Health check endpoint for Render zero-downtime deployments
- Metrics endpoint with CPU, memory, and request tracking
- CPU stress testing endpoint
- Environment variable configuration
- Production-optimized (GIN_MODE=release)

## Endpoints

| Endpoint     | Method | Description                              |
|--------------|--------|------------------------------------------|
| `/`          | GET    | Welcome message                          |
| `/health`    | GET    | Health check (used by Render)            |
| `/ping`      | GET    | Simple ping test                         |
| `/metrics`   | GET    | Service metrics (CPU, memory, requests)  |
| `/spike`     | GET    | CPU stress test (optional `duration` query param in seconds) |

## Environment Variables

| Variable       | Default           | Description                        |
|----------------|-------------------|------------------------------------|
| `PORT`         | `3004`            | Server port (auto-set by Render)   |
| `SERVICE_NAME` | `service-go-04`   | Service identifier                 |
| `PLATFORM`     | `render`          | Deployment platform tag            |
| `GIN_MODE`     | `release`         | Gin framework mode                 |

## Local Development

### Prerequisites
- Go 1.22+
- Docker (for container testing)

### Run Locally

```bash
# Install dependencies
go mod tidy

# Run the service
go run main.go
```

Access at http://localhost:3004/

### Run with Docker

```bash
# Build the image
docker build -t microservice-04 .

# Run the container
docker run -p 3004:3004 --env PORT=3004 microservice-04
```

## Deployment on Render

This microservice is fully configured for Render deployment.

### Option 1: Docker Deploy (Recommended)

1. Push your code to a GitHub/GitLab repository.

2. In Render Dashboard:
   - Click **New +** → **Web Service**
   - Connect your repository
   - Select the `microservice-04` directory (or repo root if monorepo)

3. Configure the service:
   - **Name:** `microservice-04` (or your preferred name)
   - **Runtime:** `Docker`
   - **Dockerfile Path:** `./microservice-04/Dockerfile` (or `./Dockerfile` if at root)
   - **Region:** Choose your preferred region
   - **Instance Type:** Starter (or higher)

4. Advanced options (optional):
   - **Environment Variables:**
     - `SERVICE_NAME`: `service-go-04`
     - `PLATFORM`: `render`
   - **Health Check Path:** `/health`
   - **Auto-Deploy:** Yes (on push to your branch)

5. Click **Create Web Service**

### Option 2: Native Go Environment Deploy

1. In Render Dashboard:
   - Click **New +** → **Web Service**
   - Connect your repository

2. Configure:
   - **Runtime:** `Go`
   - **Region:** Your preferred region
   - **Build Command:**
     ```bash
     cd microservice-04 && go build -tags netgo -ldflags '-s -w' -o main .
     ```
   - **Start Command:**
     ```bash
     cd microservice-04 && ./main
     ```
   - **Environment Variables:**
     - `GOVERSION`: `1.22.0`
     - `PORT`: `10000` (Render sets this automatically, but can be overridden)
   - **Health Check Path:** `/health`

### Post-Deployment Verification

Once deployed, test the endpoints:

```bash
# Check health
curl https://your-service-name.onrender.com/health

# Check metrics
curl https://your-service-name.onrender.com/metrics

# Simple ping
curl https://your-service-name.onrender.com/ping
```

## Project Structure

```
microservice-04/
├── .dockerignore    # Docker build exclusions
├── Dockerfile       # Multi-stage production Dockerfile
├── go.mod           # Go module definition
├── main.go          # Service entrypoint with routes
└── README.md        # This file
```

## Docker Build Details

The Dockerfile uses a multi-stage build:
- **Builder Stage:** `golang:1.22-alpine` - Compiles the Go binary with optimizations
- **Final Stage:** `alpine:3.19` - Minimal image with only CA certs and timezone data

Build flags:
- `CGO_ENABLED=0` - Static binary (no C dependencies)
- `-ldflags="-s -w"` - Strips debug symbols (smaller binary)
- `GOOS=linux` - Target Linux platform (Render runs on Linux)