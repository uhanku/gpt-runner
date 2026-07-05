#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
compose_file="$repo_root/docker-compose.yml"
started_mongo=0

cleanup() {
  if [ "$started_mongo" -eq 1 ]; then
    docker compose -f "$compose_file" down >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

if ! docker compose -f "$compose_file" ps -q mongo | xargs -r docker inspect -f '{{.State.Running}}' 2>/dev/null | grep -qx true; then
  docker compose -f "$compose_file" up -d mongo
  started_mongo=1
fi

for _ in $(seq 1 30); do
  if docker compose -f "$compose_file" exec -T mongo mongosh --quiet --eval 'db.adminCommand({ ping: 1 }).ok' >/dev/null 2>&1; then
    break
  fi

  sleep 1
done

npm run seed:available-images
npm run build:images
node -r ts-node/register --test test/**/*.integration.ts
