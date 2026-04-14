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
      return json(
        { error: "Method not allowed", message: "Use POST." },
        405,
        corsHeaders
      );
    }

    if (!env.OPENAI_API_KEY) {
      return json(
        {
          error: "Missing OPENAI_API_KEY",
          message: "Set OPENAI_API_KEY in your Worker environment variables.",
        },
        500,
        corsHeaders
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json(
        { error: "Invalid JSON", message: "Request body must be JSON." },
        400,
        corsHeaders
      );
    }

    const input = normalizeRequest(body);

    try {
      const result = await generateModWithOpenAI(env, input);
      return json(result, 200, corsHeaders);
    } catch (err) {
      return json(
        {
          error: "OpenAI request failed",
          message: err?.message || String(err),
          fallback: buildFallbackResult(input),
        },
        500,
        corsHeaders
      );
    }
  },
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers,
  });
}

function safeString(v) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function isObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function normalizeRequest(body) {
  const currentModName = safeString(body?.currentModName || body?.name || "");
  const request = safeString(body?.request || body?.prompt || "");
  const currentVersion = Number(body?.currentVersion || 0) || 0;

  const existingVersions = Array.isArray(body?.existingVersions)
    ? body.existingVersions.map((v) => ({
        version: Number(v?.version || 0) || 0,
        summary: safeString(v?.summary || ""),
      }))
    : [];

  const basePatch = isObject(body?.basePatch) ? body.basePatch : {};

  return {
    currentModName,
    request,
    currentVersion,
    existingVersions,
    basePatch,
  };
}

function buildSystemPrompt() {
  return [
    "あなたは将棋MODの編集AIです。",
    "返答は必ずJSONのみ。",
    "",
    "文章は必ず簡潔な日本語にする。",
    "説明は短く、自然で、暗号っぽくしない。",
    "summary は 1〜2文の短い日本語。",
    "prompt は必要なら短い日本語の補足。",
    "",
    "schema:",
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
    "}",
    "",
    "ルール:",
    "1. 既存の対戦機能は壊さない。",
    "2. 変更は小さく安全にする。",
    "3. 迷ったら控えめな改善にする。",
    "4. JSON以外を出さない。",
  ].join("\n");
}

async function generateModWithOpenAI(env, input) {
  const model = env.OPENAI_MODEL || "gpt-4.1-mini";

  const userPrompt = [
    `MOD名: ${input.currentModName || "(未設定)"}`,
    `現在のバージョン数: ${input.currentVersion || 0}`,
    "",
    "既存バージョン:",
    ...(input.existingVersions.length
      ? input.existingVersions.map((v) => `- v${v.version}: ${v.summary || "説明なし"}`)
      : ["- なし"]),
    "",
    "ベース設定:",
    JSON.stringify(input.basePatch || {}, null, 2),
    "",
    "依頼内容:",
    input.request || "(なし)",
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: buildSystemPrompt(),
      input: userPrompt,
      temperature: 0.3,
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
                      piece2: { type: "string" },
                    },
                  },
                  game: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      cooldownMs: { type: "number" },
                      handCooldownMs: { type: "number" },
                      cpuDelayMin: { type: "number" },
                      cpuDelayMax: { type: "number" },
                      seriousCpuInterval: { type: "number" },
                    },
                  },
                  labels: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      kingBlack: { type: "string" },
                      kingWhite: { type: "string" },
                    },
                  },
                  rules: {
                    type: "object",
                    additionalProperties: true,
                  },
                  ui: {
                    type: "object",
                    additionalProperties: true,
                  },
                },
                required: ["theme", "game", "labels", "rules", "ui"],
              },
            },
            required: ["summary", "prompt", "patch"],
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenAI ${response.status}: ${text.slice(0, 500)}`);
  }

  const data = await response.json();
  const text = extractOutputText(data);

  if (!text) return buildFallbackResult(input);

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = buildFallbackResult(input);
  }

  return sanitizeResult(parsed, input);
}

function extractOutputText(data) {
  if (!data || typeof data !== "object") return "";

  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const out = Array.isArray(data.output) ? data.output : [];
  for (const item of out) {
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

function sanitizeResult(parsed, input) {
  const fallback = buildFallbackResult(input);
  return {
    summary: safeString(parsed?.summary || fallback.summary),
    prompt: safeString(parsed?.prompt || fallback.prompt),
    patch: mergePatch(fallback.patch, isObject(parsed?.patch) ? parsed.patch : {}),
  };
}

function buildFallbackResult(input) {
  return {
    summary: `${input.currentModName || "MOD"}の試作版。`,
    prompt: input.request || "",
    patch: {
      theme: {},
      game: {
        cooldownMs: 3000,
        handCooldownMs: 3000,
        cpuDelayMin: 1000,
        cpuDelayMax: 1500,
        seriousCpuInterval: 100,
      },
      labels: {},
      rules: {},
      ui: {},
    },
  };
}

function mergePatch(base, extra) {
  const out = deepClone(base);

  if (extra.theme) out.theme = { ...(out.theme || {}), ...pickStringFields(extra.theme, ["boardLight", "boardDark", "piece1", "piece2"]) };
  if (extra.game) out.game = { ...(out.game || {}), ...pickNumberFields(extra.game, ["cooldownMs", "handCooldownMs", "cpuDelayMin", "cpuDelayMax", "seriousCpuInterval"]) };
  if (extra.labels) out.labels = { ...(out.labels || {}), ...pickStringFields(extra.labels, ["kingBlack", "kingWhite"]) };
  if (extra.rules && isObject(extra.rules)) out.rules = deepMergeObjects(out.rules || {}, extra.rules);
  if (extra.ui && isObject(extra.ui)) out.ui = deepMergeObjects(out.ui || {}, extra.ui);

  return out;
}

function deepClone(v) {
  return JSON.parse(JSON.stringify(v || {}));
}

function deepMergeObjects(a, b) {
  const out = Array.isArray(a) ? a.slice() : { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (isObject(v) && isObject(out[k])) {
      out[k] = deepMergeObjects(out[k], v);
    } else if (Array.isArray(v)) {
      out[k] = v.slice();
    } else {
      out[k] = v;
    }
  }
  return out;
}

function pickStringFields(obj, keys) {
  const out = {};
  for (const key of keys) {
    if (typeof obj?.[key] === "string") out[key] = obj[key];
  }
  return out;
}

function pickNumberFields(obj, keys) {
  const out = {};
  for (const key of keys) {
    const n = Number(obj?.[key]);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}
