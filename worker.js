export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Content-Type": "application/json; charset=utf-8",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, corsHeaders);
    }

    if (!env.OPENAI_API_KEY) {
      return json({
        error: "Missing OPENAI_API_KEY",
        message: "Set OPENAI_API_KEY in the Worker settings."
      }, 500, corsHeaders);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400, corsHeaders);
    }

    const input = normalizeRequest(body);

    try {
      const result = await generateMod(env, input);
      return json(result, 200, corsHeaders);
    } catch (err) {
      return json({
        error: "OpenAI request failed",
        message: err?.message || String(err),
        fallback: fallbackResult(input)
      }, 500, corsHeaders);
    }
  }
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), { status, headers });
}

function normalizeRequest(body) {
  return {
    currentModName: typeof body?.currentModName === "string" ? body.currentModName : "",
    request: typeof body?.request === "string" ? body.request : "",
    currentVersion: Number(body?.currentVersion || 0) || 0,
    existingVersions: Array.isArray(body?.existingVersions) ? body.existingVersions : [],
    basePatch: isObj(body?.basePatch) ? body.basePatch : {}
  };
}

function isObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function systemPrompt() {
  return [
    "あなたは将棋ゲームのMOD生成AIです。",
    "出力はJSONのみ。",
    "summary は簡潔な日本語にする。",
    "prompt は短い日本語にする。",
    "暗号っぽい記号の列は禁止。",
    "説明は人が読んで一発でわかるようにする。",
    "",
    "返すJSON schema:",
    "{",
    '  "summary": string,',
    '  "prompt": string,',
    '  "patch": {',
    '    "theme": { "boardLight"?: string, "boardDark"?: string, "piece1"?: string, "piece2"?: string },',
    '    "game": { "cooldownMs"?: number, "handCooldownMs"?: number, "cpuDelayMin"?: number, "cpuDelayMax"?: number, "seriousCpuInterval"?: number },',
    '    "labels": { "kingBlack"?: string, "kingWhite"?: string },',
    '    "rules": object,',
    '    "ui": object',
    "  }",
    "}"
  ].join("\n");
}

async function generateMod(env, input) {
  const payload = [
    `MOD名: ${input.currentModName || "(未設定)"}`,
    `現在のバージョン数: ${input.currentVersion || 0}`,
    "",
    "既存バージョン:",
    ...(input.existingVersions.length
      ? input.existingVersions.map(v => `- v${Number(v.version || 0)}: ${String(v.summary || "")}`)
      : ["- なし"]),
    "",
    "ベース設定:",
    JSON.stringify(input.basePatch || {}, null, 2),
    "",
    "依頼内容:",
    input.request || "(なし)"
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4.1-mini",
      instructions: systemPrompt(),
      input: payload,
      temperature: 0.2,
      max_output_tokens: 1200,
      text: {
        format: {
          type: "json_schema",
          name: "mod_patch",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: { type: "string" },
              prompt: { type: "string" },
              patch: {
                type: "object",
                additionalProperties: false,
                properties: {
                  theme: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      boardLight: { type: "string" },
                      boardDark: { type: "string" },
                      piece1: { type: "string" },
                      piece2: { type: "string" }
                    }
                  },
                  game: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      cooldownMs: { type: "number" },
                      handCooldownMs: { type: "number" },
                      cpuDelayMin: { type: "number" },
                      cpuDelayMax: { type: "number" },
                      seriousCpuInterval: { type: "number" }
                    }
                  },
                  labels: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      kingBlack: { type: "string" },
                      kingWhite: { type: "string" }
                    }
                  },
                  rules: { type: "object", additionalProperties: true },
                  ui: { type: "object", additionalProperties: true }
                },
                required: ["theme", "game", "labels", "rules", "ui"]
              }
            },
            required: ["summary", "prompt", "patch"]
          }
        }
      }
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 400)}`);
  }

  const data = await res.json();
  const text = extractText(data);
  if (!text) return fallbackResult(input);

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = fallbackResult(input);
  }

  return sanitize(parsed, input);
}

function extractText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part?.type === "output_text" && typeof part.text === "string") {
          return part.text.trim();
        }
      }
    }
  }
  return "";
}

function sanitize(parsed, input) {
  const fb = fallbackResult(input);
  return {
    summary: cleanString(parsed?.summary) || fb.summary,
    prompt: cleanString(parsed?.prompt) || fb.prompt,
    patch: mergePatch(fb.patch, isObj(parsed?.patch) ? parsed.patch : {})
  };
}

function cleanString(v) {
  return typeof v === "string" ? v.trim() : "";
}

function fallbackResult(input) {
  return {
    summary: `試作MOD「${input.currentModName || "MOD"}」`,
    prompt: input.request || "",
    patch: {
      theme: {},
      game: {
        cooldownMs: 3000,
        handCooldownMs: 3000,
        cpuDelayMin: 1000,
        cpuDelayMax: 1500,
        seriousCpuInterval: 100
      },
      labels: {},
      rules: {},
      ui: {}
    }
  };
}

function mergePatch(base, extra) {
  const out = deepClone(base);
  if (extra.theme) out.theme = { ...(out.theme || {}), ...pickStrings(extra.theme, ["boardLight", "boardDark", "piece1", "piece2"]) };
  if (extra.game) out.game = { ...(out.game || {}), ...pickNumbers(extra.game, ["cooldownMs", "handCooldownMs", "cpuDelayMin", "cpuDelayMax", "seriousCpuInterval"]) };
  if (extra.labels) out.labels = { ...(out.labels || {}), ...pickStrings(extra.labels, ["kingBlack", "kingWhite"]) };
  if (extra.rules && isObj(extra.rules)) out.rules = deepMerge(out.rules || {}, extra.rules);
  if (extra.ui && isObj(extra.ui)) out.ui = deepMerge(out.ui || {}, extra.ui);
  return out;
}

function deepClone(v) {
  return JSON.parse(JSON.stringify(v || {}));
}

function deepMerge(a, b) {
  const out = Array.isArray(a) ? a.slice() : { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (isObj(v) && isObj(out[k])) out[k] = deepMerge(out[k], v);
    else if (Array.isArray(v)) out[k] = v.slice();
    else out[k] = v;
  }
  return out;
}

function pickStrings(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (typeof obj?.[k] === "string") out[k] = obj[k];
  }
  return out;
}

function pickNumbers(obj, keys) {
  const out = {};
  for (const k of keys) {
    const n = Number(obj?.[k]);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}
