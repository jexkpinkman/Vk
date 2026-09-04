# JexkCode Fetch

A simple, reliable, modern universal video downloader built with Node.js + Express.

## Priority

**VK video support is the main priority.** Also supports YouTube and direct video URLs.

## Tech Stack

- Node.js
- Express
- HTML / CSS / Vanilla JavaScript

## Install

```bash
cd jexkcode-fetch
npm install
```

## Run

```bash
npm start
```

Open http://localhost:3000

## Supported Sites

| Platform | Status |
|----------|--------|
| VK (vk.com / vkvideo.ru) | Primary |
| YouTube | Supported |
| Direct video URLs | Supported |

## API Endpoints

- `POST /api/analyze` — Analyze a video URL and return metadata + formats
- `POST /api/download` — Start a download job
- `GET /api/download/:id` — Poll download progress
- `GET /api/file/:id` — Download the completed file

## Architecture

- No database, no auth, no queues
- Streams directly to disk — no RAM bloat
- Real byte-level progress tracking
- Content-Length used when available; indeterminate progress when unknown

## Notes

- Only public/authorized content is processed
- No DRM bypasses, no private video unlocking
- Downloads are cleaned up after the file is served
