# Microservice 05 - Ruby Sinatra

A production-ready microservice using Ruby 3.3 and Sinatra framework, optimized for deployment on Render.

## Features

- Multi-stage Alpine Docker build for small image size
- Graceful shutdown with at_exit handler
- Health check endpoint for Render zero-downtime deployments
- Metrics endpoint with CPU, memory, and request tracking
- CPU stress testing endpoint
- Environment variable configuration
- Production-optimized (RACK_ENV=production)

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
| `PORT`         | `3005`            | Server port (auto-set by Render)   |
| `SERVICE_NAME` | `service-ruby-05` | Service identifier                 |
| `PLATFORM`     | `render`          | Deployment platform tag            |
| `RACK_ENV`     | `production`      | Rack environment mode              |

## Local Development

### Prerequisites
- Ruby 3.2+
- Bundler 2+
- Docker (for container testing)

### Run Locally

```bash
# Install dependencies
bundle install

# Run the service
ruby app.rb
```

Access at http://localhost:3005/

### Run with Docker

```bash
# Build the image
docker build -t microservice-05 .

# Run the container
docker run -p 3005:3005 --env PORT=3005 microservice-05
```

## Deployment on Render

This microservice is fully configured for Render deployment.

### Option 1: Docker Deploy (Recommended)

1. Push your code to a GitHub/GitLab repository.

2. In Render Dashboard:
   - Click **New +** → **Web Service**
   - Connect your repository
   - Select the `microservice-05` directory (or repo root if monorepo)

3. Configure the service:
   - **Name:** `microservice-05` (or your preferred name)
   - **Runtime:** `Docker`
   - **Dockerfile Path:** `./microservice-05/Dockerfile` (or `./Dockerfile` if at root)
   - **Region:** Choose your preferred region
   - **Instance Type:** Starter (or higher)

4. Advanced options (optional):
   - **Environment Variables:**
     - `SERVICE_NAME`: `service-ruby-05`
     - `PLATFORM`: `render`
   - **Health Check Path:** `/health`
   - **Auto-Deploy:** Yes (on push to your branch)

5. Click **Create Web Service**

### Option 2: Native Ruby Environment Deploy

1. In Render Dashboard:
   - Click **New +** → **Web Service**
   - Connect your repository

2. Configure:
   - **Runtime:** `Ruby`
   - **Region:** Your preferred region
   - **Build Command:**
     ```bash
     cd microservice-05 && bundle install
     ```
   - **Start Command:**
     ```bash
     cd microservice-05 && bundle exec ruby app.rb
     ```
   - **Environment Variables:**
     - `RUBY_VERSION`: `3.3.0`
     - `RACK_ENV`: `production`
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
microservice-05/
├── .dockerignore    # Docker build exclusions
├── Dockerfile       # Multi-stage production Dockerfile
├── Gemfile          # Ruby dependencies
├── app.rb           # Service entrypoint with routes
└── README.md        # This file
```

## Docker Build Details

The Dockerfile uses a multi-stage build:
- **Builder Stage:** `ruby:3.3-alpine` - Installs gems with build tools
- **Final Stage:** `ruby:3.3-alpine` - Minimal runtime image with only gems and app code

Benefits:
- Smaller final image (~100MB vs ~500MB)
- No build tools in production (reduced attack surface)
- Production gemset only (no development/test gems)