# MakeCode AI Proxy — Server

A lightweight Node.js service that takes a plain-text request (plus optional current MakeCode code) and returns Blocks-compatible **MakeCode Static TypeScript**.
It centralizes model selection and API keys on the server so end users never handle keys.

---

## Features

* **Centralized model routing** (via OpenRouter): choose a preset like `openai/chatgpt-4o-latest`, `google/gemini-2.5-pro`, etc., all with a single server key.
* **Preset management** with persistence (`config.json`): set the active preset at runtime.
* **Strict MakeCode output**: validates and nudges the model to emit Blocks-decompilable code only.
* **Simple REST API**: health check, get/set preset, generate code.
* **Built-in rate limiting** and optional bearer token auth.
* **CORS control** for safe cross-origin usage.

---

## Quick Start

### 1) Requirements

* Node.js 18+ (Node 22 recommended)
* An **OpenRouter API key** (required)
* (Optional) An OpenAI API key if you intend to route directly to OpenAI (by default, everything routes through OpenRouter)

### 2) Install

```bash
npm install
```

### 3) Configure environment

Create a `.env` file in the project root:

```dotenv
# Server
PORT=8787

# Auth (optional)
SERVER_APP_TOKEN=your_shared_secret   # If set, all requests must send: Authorization: Bearer <token>

# CORS (optional) – comma-separated list of allowed origins
CORS_ORIGINS=https://makecode.microbit.org,https://arcade.makecode.com

# API keys
OPENROUTER_API_KEY=YOUR_OPENROUTER_KEY
# OPENAI_API_KEY=YOUR_OPENAI_KEY   # optional; not required if all models route via OpenRouter
```

> **Note:** If `SERVER_APP_TOKEN` is set, clients must include `Authorization: Bearer <token>` in every request.

### 4) Run

```bash
npm run dev
# or
node index.js
```

Server will log:

```
MC-AI proxy listening on http://localhost:8787
```

---

## Presets & Model Routing

Presets are human-readable labels the server exposes and persists in `config.json`. Internally, each preset is resolved to a concrete provider/model slug (typically OpenRouter slugs) via `resolvePreset()`.

**Default preset**: `openai/chatgpt-4o-latest` → routed to `openai/gpt-4o` on OpenRouter.

You can edit the initial list by changing the `presets` array in `readConfig()` or by editing `config.json` after first run.

Example `config.json` (auto-created on first run if missing):

```json
{
  "activePreset": "openai/chatgpt-4o-latest",
  "presets": [
    "openai/chatgpt-4o-latest",
    "openai/gpt-5-mini",
    "google/gemini-2.5-pro",
    "google/gemini-2.5-flash",
    "anthropic/claude-sonnet-4.5",
    "x-ai/grok-code-fast-1",
    "qwen/qwen3-coder-30b-a3b-instruct",
    "openrouter/auto"
  ]
}
```

To add/remove models:

1. Add/remove the label in `config.json` (or let the server create it on first run).
2. Map that label to an OpenRouter slug inside `resolvePreset()` in `index.js`.

---

## API

Base URL: `http://<host>:<port>`

### `GET /health`

Simple health check.

**Response**

```json
{ "status": "ok" }
```

---

### `GET /mcai/config`

Returns the current active preset and the list of available presets.

**Response**

```json
{
  "activePreset": "openai/chatgpt-4o-latest",
  "presets": [
    "openai/chatgpt-4o-latest",
    "openai/gpt-5-mini",
    "google/gemini-2.5-pro",
    "google/gemini-2.5-flash",
    "anthropic/claude-sonnet-4.5",
    "x-ai/grok-code-fast-1",
    "qwen/qwen3-coder-30b-a3b-instruct",
    "openrouter/auto"
  ]
}
```

**cURL**

```bash
curl -s http://localhost:8787/mcai/config
```

If `SERVER_APP_TOKEN` is set:

```bash
curl -s -H "Authorization: Bearer YOUR_TOKEN" http://localhost:8787/mcai/config
```

---

### `POST /mcai/config`

Sets the active preset (and persists it to `config.json`).

**Request**

```json
{ "preset": "google/gemini-2.5-pro" }
```

**Response**

```json
{ "ok": true, "activePreset": "google/gemini-2.5-pro" }
```

**cURL**

```bash
curl -s -X POST http://localhost:8787/mcai/config \
  -H "Content-Type: application/json" \
  -d '{"preset":"google/gemini-2.5-pro"}'
```

---

### `POST /mcai/generate`

Generates MakeCode-compatible Static TypeScript using the **current active preset**.

**Request**

```json
{
  "target": "microbit",          // one of: microbit | arcade | maker
  "request": "show a smiley",    // natural language request
  "currentCode": ""              // optional: include current MakeCode code for context
}
```

**Response**

```json
{
  "code": "basic.onStart(function () {\n    basic.showIcon(IconNames.Happy)\n})",
  "feedback": [
    "Kept APIs to micro:bit namespace.",
    "Avoided forbidden constructs."
  ]
}
```

**cURL**

```bash
curl -s -X POST http://localhost:8787/mcai/generate \
  -H "Content-Type: application/json" \
  -d '{
    "target":"microbit",
    "request":"Display a heart when A is pressed",
    "currentCode":""
  }'
```

> The server validates output (no arrow functions, no async/await, etc.) and will try to self-correct. If the model fails, it returns a tiny, safe stub for the chosen target.

---

## Security & Limits

* **Bearer auth (optional):** set `SERVER_APP_TOKEN` to require `Authorization: Bearer <token>` on all endpoints.
* **CORS:** set `CORS_ORIGINS` to a comma-separated allow-list. If omitted, all origins are allowed.
* **Rate limiting:** default `max: 30` requests per minute per IP. Tune in `index.js`.

---

## Deployment

You can deploy on any Node-friendly host. Typical steps:

1. Set environment variables (`OPENROUTER_API_KEY`, `SERVER_APP_TOKEN`, `CORS_ORIGINS`, `PORT`).
2. Start the app (`node index.js` or run it with a process manager like `pm2`).
3. Point your frontend or tool at `https://your-domain/mcai/*`.

> If you change the preset list, restart the server or edit `config.json` directly.

---

## Troubleshooting

* **`OPENROUTER_API_KEY missing`**
  Set it in `.env` or your host’s env settings.

* **`401 Unauthorized`**
  You set `SERVER_APP_TOKEN`; include `Authorization: Bearer <token>`.

* **CORS errors in browser**
  Add your origin(s) to `CORS_ORIGINS` (comma-separated). Example:

  ```
  CORS_ORIGINS=https://makecode.microbit.org,https://arcade.makecode.com
  ```

* **Model not found / 404 from provider**
  Your OpenRouter account may not have access to the slug. Update the mapping in `resolvePreset()` or choose a different preset.

* **Output won’t decompile to Blocks**
  The server already retries with stricter instructions and finally falls back to a safe stub. If it persists, try a different preset or simplify the prompt.

---

## File Structure (server only)

```
.
├─ index.js          # Main server
├─ config.json       # Active preset & preset list (auto-created)
├─ package.json
├─ .env              # environment variables (not committed)
└─ status.html       
```

---

## License

MIT .
