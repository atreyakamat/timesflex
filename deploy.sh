#!/bin/sh
# Builds and starts TimeFlex with Docker, waits until it is healthy, and says where it is.
set -eu
cd "$(dirname "$0")"

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker with the compose plugin is needed: https://docs.docker.com/engine/install/" >&2
  exit 1
fi

if [ ! -f .env ]; then
  password=$(LC_ALL=C tr -dc 'a-zA-Z0-9' </dev/urandom | head -c 32)
  sed "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$password/" .env.example >.env
  chmod 600 .env
  echo "Created .env with a random database password."
fi

if grep -q '^POSTGRES_PASSWORD=change-me$' .env; then
  echo "Set a real POSTGRES_PASSWORD in .env first." >&2
  exit 1
fi

docker compose up -d --build

# Not "up --wait": it counts the model download finishing as a failure.
echo "Waiting for the app to be ready..."
tries=0
until [ "$(docker compose ps web --format '{{.Health}}')" = "healthy" ]; do
  tries=$((tries + 1))
  if [ "$tries" -ge 100 ]; then
    echo "The app did not become healthy. See: docker compose logs web api" >&2
    exit 1
  fi
  sleep 3
done

port=$(sed -n 's/^WEB_PORT=//p' .env | head -n 1)
address=$(tailscale ip -4 2>/dev/null | head -n 1 || true)
echo
echo "TimeFlex is running:"
echo "  on this machine:   http://localhost:${port:-8080}"
[ -n "$address" ] && echo "  on your tailnet:   http://$address:${port:-8080}"
echo
echo "The AI model downloads in the background. Until it's ready, the built-in rules answer."
echo "Watch it: docker compose logs -f ollama-pull"
