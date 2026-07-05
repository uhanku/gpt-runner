#!/usr/bin/env bash
set -euo pipefail

npm run lint
npm test
npm run test:integration
