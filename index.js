const express = require("express");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

// ---------- config persistence ----------
const CONFIG_PATH = path.join(__dirname, "config.json");
function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const init = {
      // default selection
      activePreset: "openai/chatgpt-4o-latest",
      // the UI will show->
      presets: [
        "openai/chatgpt-4o-latest",
        "openai/gpt-5",
        "google/gemini-2.5-pro",
        "google/gemini-2.5-flash",
        "anthropic/claude-sonnet-4.5",
        "x-ai/grok-code-fast-1",
        "qwen/qwen3-coder",
        "deepseek/deepseek-chat-v3.1:free",
        "openrouter/auto"
      ]
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(init, null, 2));
    return init;
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function writeConfig(cfg) {
  const tmp = CONFIG_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, CONFIG_PATH);
}
let CONFIG = readConfig();

// ---------- env ----------
require("dotenv").config();
const PORT = process.env.PORT || 8787;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const SERVER_APP_TOKEN = process.env.SERVER_APP_TOKEN || "";
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);

// ---------- app ----------
const app = express();
app.use(express.json({ limit: "1mb" }));

app.use(cors({
  origin: (origin, cb) => {
    if (!CORS_ORIGINS.length) return cb(null, true);
    if (!origin) return cb(null, true); // allow tools/curl
    if (CORS_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error("CORS not allowed from origin: " + origin));
  }
}));
// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/", (req, res) => {
  res.sendFile("status.html", { root: __dirname });
});

// optional bearer auth
app.use((req, res, next) => {
  if (!SERVER_APP_TOKEN) return next();
  const h = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (h !== SERVER_APP_TOKEN) return res.status(401).json({ error: "Unauthorized" });
  next();
});

// basic rate limit
app.use(rateLimit({ windowMs: 60_000, max: 30 }));

// ---------- helpers ----------
const BASE_TEMP = 0.1;
const MAXTOK = 3072;

function sysFor(target) {
  let ns = "basic,input,music,led,radio,pins,loops,logic,variables,math,functions,arrays,text,game,images,serial,control";
  let targetName = "micro:bit";
  if (target === "arcade") { ns = "controller,game,scene,sprites,info,music,effects,game"; targetName = "Arcade"; }
  if (target === "maker") { ns = "pins,input,loops,music"; targetName = "Maker"; }
  return [
    "ROLE: You are a Microsoft MakeCode assistant.",
    "HARD REQUIREMENT: Return ONLY Microsoft MakeCode Static JavaScript that the MakeCode decompiler can convert to BLOCKS for " + targetName + " with ZERO errors.",
    'OPTIONAL FEEDBACK: You may send brief notes before the code. Prefix each note with "FEEDBACK: ".',
    "RESPONSE FORMAT: After any feedback lines, output ONLY Microsoft MakeCode Static TypeScript with no markdown fences or extra prose.",
    "NO COMMENTS inside the code.",
    "ALLOWED APIS: " + ns + ". Prefer event handlers and forever/update loops.",
    "FORBIDDEN IN OUTPUT: arrow functions (=>), classes, new constructors, async/await/Promise, import/export, template strings (`), higher-order array methods (map/filter/reduce/forEach/find/some/every), namespaces/modules, enums, interfaces, type aliases, generics, timers (setTimeout/setInterval), console calls, markdown, escaped newlines, onstart functions, and any other javascript code that cannot be converted into blocks",
    "TARGET-SCOPE: Use ONLY APIs valid for " + targetName + ". Never mix Arcade APIs into micro:bit/Maker or vice versa.",
    "STYLE: Straight quotes, ASCII only, real newlines, use function () { } handlers.",
    "VAGUE REQUESTS: Choose sensible defaults and still produce a small interactive program.",
    "SELF-CHECK BEFORE SENDING: Ensure every forbidden construct is removed; ensure only allowed APIs for " + targetName + " are used; ensure it decompiles to BLOCKS.",
    "IF UNSURE: Return a minimal program that is guaranteed to decompile to BLOCKS for " + targetName + ". Code only."
  ].join("\n");
}
function userFor(request, current) {
  const header = "USER_REQUEST:\n" + (request || "").trim();
  if (current && current.trim().length) {
    return header + "\n\n<<<CURRENT_CODE>>>\n" + current + "\n<<<END_CURRENT_CODE>>>";
  }
  return header;
}
function sanitize(txt = "") {
  let s = String(txt);
  if (/^```/.test(s)) s = s.replace(/^```[\s\S]*?\n/, "").replace(/```\s*$/, "");
  s = s.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  s = s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\u00A0/g, " ");
  s = s.replace(/^`+|`+$/g, "");
  return s.trim();
}
function separateFeedback(raw = "") {
  const feedback = [];
  const lines = String(raw).replace(/\r\n/g, "\n").split("\n");
  const bodyLines = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^FEEDBACK:/i.test(t)) { feedback.push(t.replace(/^FEEDBACK:\s*/i, "").trim()); continue; }
    bodyLines.push(line);
  }
  return { feedback, body: bodyLines.join("\n").trim() };
}
function extractCode(s = "") {
  const m = s.match(/```[a-z]*\n([\s\S]*?)```/);
  const code = m ? m[1] : s;
  return sanitize(code);
}
function validateBlocksCompatibility(code, target) {
  const rules = [
    { re: /=>/g, why: "arrow functions" },
    { re: /\bclass\s+/g, why: "classes" },
    { re: /\bnew\s+[A-Z_a-z]/g, why: "new constructor" },
    { re: /\bPromise\b|\basync\b|\bawait\b/g, why: "promises/async" },
    { re: /\bimport\s|\bexport\s/g, why: "import/export" },
    { re: /`/g, why: "template strings" },
    { re: /\.\s*(map|forEach|filter|reduce|find|some|every)\s*\(/g, why: "higher-order array methods" },
    { re: /\bnamespace\b|\bmodule\b/g, why: "namespaces/modules" },
    { re: /\benum\b|\binterface\b|\btype\s+[A-Z_a-z]/g, why: "TS types/enums" },
    { re: /<\s*[A-Z_a-z0-9_,\s]+>/g, why: "generics syntax" },
    { re: /setTimeout\s*\(|setInterval\s*\(/g, why: "timers" },
    { re: /console\./g, why: "console calls" },
    { re: /^\s*\/\//m, why: "line comments" },
    { re: /\/\*[\s\S]*?\*\//g, why: "block comments" }
  ];
  const violations = [];
  for (const r of rules) if (r.re.test(code)) violations.push(r.why);
  if (target === "microbit" || target === "maker") {
    if (/sprites\.|controller\.|scene\.|game\.onUpdate/i.test(code)) violations.push("Arcade APIs in micro:bit/Maker");
  }
  if (target === "arcade") {
    if (/led\./i.test(code) || /radio\./i.test(code)) violations.push("micro:bit APIs in Arcade");
  }
  if (/[^\x09\x0A\x0D\x20-\x7E]/.test(code)) violations.push("non-ASCII characters");
  return { ok: violations.length === 0, violations: Array.from(new Set(violations)) };
}

// ---------- provider callers ----------
async function callOpenAI(model, sys, user) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
  const body = { model: model || "chatgpt-4o-latest", temperature: BASE_TEMP, max_tokens: MAXTOK, messages: [{ role: "system", content: sys }, { role: "user", content: user }] };
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(await r.text());
  const j = await r.json();
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || "").trim();
}
async function callOpenRouter(model, sys, user, req) {
  if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY missing");
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
    "X-Title": "MakeCode AI"
  };
  // best-effort referer for OpenRouter analytics
  try {
    const origin = req?.headers?.origin;
    if (origin) headers["HTTP-Referer"] = new URL(origin).origin;
  } catch {}
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: model || "openrouter/auto",
      temperature: BASE_TEMP,
      max_tokens: MAXTOK,
      messages: [{ role: "system", content: sys }, { role: "user", content: user }]
    })
  });
  if (!r.ok) throw new Error(await r.text());
  const j = await r.json();
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || "").trim();
}

// ---------- preset router ----------
// IMPORTANT: route the "openai/chatgpt-4o-latest" label THROUGH OpenRouter
// All routes go through OpenRouter using a single OPENROUTER_API_KEY
function resolvePreset(preset) {
  switch (preset) {
    // Keep 4o-latest as default label, route to the OpenRouter slug
    case "openai/chatgpt-4o-latest":
      return { provider: "openrouter", model: "openai/gpt-4o" };

    // Your requested models
    case "openai/gpt-5":
      return { provider: "openrouter", model: "openai/gpt-5" };

    case "google/gemini-2.5-pro":
      return { provider: "openrouter", model: "google/gemini-2.5-pro" };

    case "google/gemini-2.5-flash":
      return { provider: "openrouter", model: "google/gemini-2.5-flash" };

    case "anthropic/claude-sonnet-4.5":
      return { provider: "openrouter", model: "anthropic/claude-3.7-sonnet" }; // If your account exposes "claude-sonnet-4.5" as a different slug, replace here.

    case "x-ai/grok-code-fast-1":
      return { provider: "openrouter", model: "x-ai/grok-code-fast-1" };

    case "qwen/qwen3-coder":
      return { provider: "openrouter", model: "qwen/qwen-3-coder" }; // If OpenRouter uses qwen/qwen3-coder exactly, change to that.

    case "deepseek/deepseek-chat-v3.1:free":
      return { provider: "openrouter", model: "deepseek/deepseek-chat-v3.1:free" };

    // Router fallback
    case "openrouter/auto":
      return { provider: "openrouter", model: "openrouter/auto" };

    default:
      // Unknown label → safe fallback
      return { provider: "openrouter", model: "openrouter/auto" };
  }
}


async function askValidatedByPreset(preset, target, request, currentCode, reqForHeaders) {
  const { provider, model } = resolvePreset(preset);
  const sys = sysFor(target);
  const user = userFor(request, currentCode || "");
  const caller = provider === "openai" ? callOpenAI : (m, s, u) => callOpenRouter(m, s, u, reqForHeaders);

  async function oneAttempt(extraSys) {
    const finalSys = sys + (extraSys ? ("\n" + extraSys) : "");
    const raw = await caller(model, finalSys, user);
    const { feedback, body } = separateFeedback(raw);
    const code = extractCode(body);
    return { feedback, code, v: validateBlocksCompatibility(code, target) };
  }

  let res = await oneAttempt();
  if (!res.code || !res.code.trim()) {
    res = await oneAttempt("Your last message returned no code. Return ONLY Blocks-decompilable MakeCode Static TypeScript. No prose.");
  }
  if (res.code && res.code.trim() && !res.v.ok) {
    const fb = "Previous code used: " + res.v.violations.join(", ") + ". Remove ALL forbidden constructs. Use only valid APIs for the target.";
    res = await oneAttempt(fb);
  }
  if (!res.code || !res.code.trim()) {
    const stub =
      target === "arcade" ? 'controller.A.onEvent(ControllerButtonEvent.Pressed, function () {\n    game.splash("Start!")\n})\ngame.onUpdate(function () {\n})'
      : target === "maker" ? 'loops.forever(function () {\n})'
      : 'basic.onStart(function () {\n    basic.showString("Hi")\n})';
    return { code: stub, feedback: res.feedback || [] };
  }
  return { code: res.code, feedback: res.feedback || [] };
}

// ---------- routes ----------

// Get active preset and available presets
app.get("/mcai/config", (req, res) => {
  res.json({ activePreset: CONFIG.activePreset, presets: CONFIG.presets.slice() });
});

// Set active preset (persists)
app.post("/mcai/config", (req, res) => {
  const { preset } = req.body || {};
  if (!preset) return res.status(400).json({ error: "Missing preset" });
  if (!CONFIG.presets.includes(preset)) return res.status(400).json({ error: "Preset not allowed" });
  CONFIG.activePreset = preset;
  writeConfig(CONFIG);
  res.json({ ok: true, activePreset: CONFIG.activePreset });
});

// Generate (uses active preset; client does NOT send provider/model)
app.post("/mcai/generate", async (req, res) => {
  try {
    const { target, request, currentCode } = req.body || {};
    if (!request || !target) return res.status(400).json({ error: "Missing request/target" });
    if (!["microbit", "arcade", "maker"].includes(target)) return res.status(400).json({ error: "Invalid target" });

    const result = await askValidatedByPreset(CONFIG.activePreset, target, request, currentCode, req);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e && e.message ? e.message : "Server error" });
  }
});

app.listen(PORT, () => {
  console.log("MC-AI proxy listening on http://localhost:" + PORT);
});
