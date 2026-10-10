# Run the existing store

Use this guide to run the checked-in application. You need Node 24, npm, Docker, and Docker Compose. Run commands from the repository root. To build a similar project from scratch instead, start [tutorial 1](../tutorials/01-workspace-and-api.md).

## Install and start persistence

```sh
node --version
npm ci
npm run db:up
docker compose ps
```

Node should report v24.x. PostgreSQL should be healthy. `npm ci` uses the checked-in lockfile.

Seed a small catalog/history rather than starting at the default million-event scale:

```sh
npm run seed -- --products 140 --shoppers 80 --events 1000 --days 10 --start 2026-07-01T00:00:00.000Z
```

The summary reports a run ID and actual event/session/order counts. Repeating this exact configuration skips completed generation. Existing populations are preserved.

## Run API and frontend

In one terminal:

```sh
npm run dev:api
```

In another:

```sh
npm run dev:web
```

Open the Vite URL, normally http://127.0.0.1:5173. Check the API from another terminal:

```sh
curl --fail http://127.0.0.1:3001/health
curl --fail 'http://127.0.0.1:3001/products?limit=1'
```

Expect `{"status":"ok"}` and a product page response. Search, open a product, add it to the bag, and place a demo order. Switch a persona and confirm its bag/history are separate. Checkout creates local records only.

## Stop and resume

Stop the two development processes with Ctrl+C. Run `npm run db:down` to stop persistence; the named volume is retained. Resume with `npm run db:up` and the development commands. Do not use `docker compose down -v` if you want to retain store data.

For another database or port, use [isolated experiments](manage-experiments.md). For failures, use [troubleshooting](troubleshoot.md). Configuration defaults are in [workspace reference](../reference/workspace.md). [Index](../README.md).
