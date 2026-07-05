#!/usr/bin/env bash
set -euo pipefail

npm run seed:available-images
npm run build:images
node -r ts-node/register --test test/**/*.integration.ts
