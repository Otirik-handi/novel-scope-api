# Novel Ranking API

Requires Node.js 20+. Run `npm install`, set `API_KEY` and optionally `SNAPSHOT_DIR` in `.env`, then use `npm run start:dev`.

`GET /v1/rankings?platform=qidian&rank=hotsales` reads a snapshot. Use `POST /v1/admin/refresh` with `X-API-Key` to refresh manually. Snapshots refresh every six hours.

The sources are neither real-time nor official public APIs. Their markup, availability, and terms may change.
