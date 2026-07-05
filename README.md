<p align="center">
  <img src="public/icon.png" alt="GPT Runner icon" width="160" />
</p>

<p align="center"><strong>GPT Runner</strong></p>

<p align="center">
  <img alt="NestJS" src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white" />
  <img alt="MongoDB" src="https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white" />
  <img alt="Docker" src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" />
  <img alt="Swagger" src="https://img.shields.io/badge/Swagger-85EA2D?style=for-the-badge&logo=swagger&logoColor=000000" />
</p>

GPT Runner exposes a NestJS API for creating jobs, preparing a disposable workspace, running commands, and collecting artifacts.

## Quick Start

1. Install dependencies:

```bash
npm ci
```

2. Configure environment variables:

Copy `.env.example` to `.env` and set at least:

- `ACTION_API_KEY`
- `PUBLIC_ARTIFACT_SECRET`
- `MONGO_URI`
- `MONGO_DB`
- `MONGO_LOGS_COLLECTION`
- `HOST`
- `PORT`
- `PUBLIC_BASE_URL`

```bash
cp .env.example .env
```

`PUBLIC_BASE_URL` should point to the externally reachable API origin used in job and artifact URLs. If it is not set, the API falls back to the incoming request origin when building links.

3. Start MongoDB:

```bash
docker compose up -d mongo
```

4. Build the API:

```bash
npm run build
```

5. Start the API:

```bash
npm start
```

6. Optionally build the helper images:

Build every image helper under `images/`:

```bash
npm run build:images
```

The API listens on `127.0.0.1:1234` by default. Override that with `HOST` and `PORT`.

## Documentation

- [Technical workflow and API notes](docs/technical.md)

`npm run test` runs the unit test suite.

`npm run test:integration` refreshes and seeds the available jobs catalog, builds the Docker images, and then runs the integration test suite.

`npm run ci` runs lint/typecheck, unit tests, and integration tests in that order.
