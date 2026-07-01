<p align="center">
  <img src="public/icon.png" alt="GPT Runner icon" width="160" style="border-radius: 25%;" />
</p>

# GPT Runner

<p align="center">
  <img alt="NestJS" src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white" />
  <img alt="MongoDB" src="https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white" />
  <img alt="Docker" src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" />
  <img alt="Swagger" src="https://img.shields.io/badge/Swagger-85EA2D?style=for-the-badge&logo=swagger&logoColor=000000" />
</p>

This project is a Custom GPT-powered code experimentation sandbox

## Production Startup

### 1. Install dependencies

```bash
npm ci
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and set at least:

- `ACTION_API_KEY`
- `PUBLIC_ARTIFACT_SECRET`
- `MONGO_URI`
- `MONGO_DB`
- `MONGO_LOGS_COLLECTION`
- `RUNNER_IMAGE`
- `HOST`
- `PORT`
- `PUBLIC_BASE_URL`

Example:

```bash
cp .env.example .env
```

### 3. Start MongoDB

```bash
docker compose up -d mongo
```

### 4. Build the runner image

```bash
docker build -t gpt-runner:bookworm ./runner
```

### 5. Build the API

```bash
npm run build
```

### 6. Start the API

```bash
npm start
```

The API listens on `127.0.0.1:8000` by default. Override that with `HOST` and `PORT` in `.env`.
Set `PUBLIC_BASE_URL` to the externally reachable API origin used in generated job and artifact download URLs.

Swagger UI is available at `http://127.0.0.1:8000/docs`.

Job files and artifacts are stored under the repo-local `./storage/<jobId>/...` directory relative to the process working directory.
Artifact download URLs are returned from authenticated `GET /jobs/<jobId>/artifacts`. The returned artifact download URLs are public signed URLs that require a valid `signature` query parameter generated with `PUBLIC_ARTIFACT_SECRET`.

# FLOWCHART

```mermaid
flowchart TD
    A[Custom GPT Action] --> B[NestJS REST API]
    B --> C[Temporary Docker container]
    C --> D[Run commands<br/>Clone repos<br/>Install packages<br/>Test code<br/>Process files]
    D --> E[Return logs and artifacts to the GPT]
```
