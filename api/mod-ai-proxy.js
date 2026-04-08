/**
 * mod-ai-proxy.js
 * ローカルで AI 欄を動かすための小さいプロキシ。
 * Node 18+ で起動して使う。
 */
const http = require("http");

const PORT = process.env.PORT || 8787;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 1e6) {
        req.destroy();
        reject(new Error("payload too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function fallbackSpec(name, prompt, baseSpec) {
  const text = `${name}\n${prompt}`.toLowerCase();
  const spec = baseSpec && typeof baseSpec === "object" ? structuredClone(baseSpec) : {};
  spec.name = name;
  spec.description = prompt || "";
  spec.engine = spec.engine || {};
  spec.visual = spec.visual || {};
  spec.rules = spec.rules || {};
  if (text.includes("速") || text.includes("スピード")) spec.engine.cooldownMs = 1500;
  if (text.includes("遅") || text.includes("ゆっくり")) spec.engine.cooldownMs = 4500;
  if (text.includes("ダーク")) spec.visual.boardDark = "#3d2f22";
  if (text.includes("ライト")) spec.visual.boardLight = "#f2dfb9";
  if (text.includes("王")) spec.rules.kingLabelMode = "fixed";
  if (text.includes("玉")) spec.rules.kingLabelMode = "fixed";
  if (spec.engine.cooldownMs == null) spec.engine.cooldownMs = 3000;
  return spec;
}

async function handle(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    });
    return res.end();
  }

  if (req.method !== "POST" || req.url !== "/api/mod-ai") {
    return json(res, 404, { error: "not_found" });
  }

  const body = await readBody(req).catch(() => null);
  if (!body) return json(res, 400, { error: "invalid_json" });

  const name = String(body.name || "NEW MOD");
  const prompt = String(body.prompt || "");
  const baseSpec = body.baseSpec && typeof body.baseSpec === "object" ? body.baseSpec : null;

  if (!OPENAI_API_KEY) {
    return json(res, 200, { ok: true, spec: fallbackSpec(name, prompt, baseSpec), source: "fallback" });
  }

  const system = [
    "You generate a compact JSON spec for a game mod.",
    "Return JSON only, no markdown.",
    "Schema:",
    "{",
    '  "name": string,',
    '  "description": string,',
    '  "engine": { "cooldownMs": number },',
    '  "visual": { "boardDark": string, "boardLight": string },',
    '  "rules": { "kingLabelMode": "dynamic" | "fixed" }',
    "}"
  ].join("\n");

  const input = [
    { role: "system", content: system },
    { role: "user", content: JSON.stringify({ name, prompt, baseSpec }) }
  ];

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-5.3-chat-latest",
      input,
      temperature: 0.4
    })
  });

  if (!response.ok) {
    const text = await response.text();
    return json(res, 200, { ok: true, spec: fallbackSpec(name, prompt, baseSpec), source: "fallback", error: text });
  }

  const data = await response.json();
  const text = data.output_text || data?.output?.[0]?.content?.[0]?.text || "{}";
  let spec;
  try {
    spec = JSON.parse(text);
  } catch {
    spec = fallbackSpec(name, prompt, baseSpec);
  }

  return json(res, 200, { ok: true, spec, source: "openai" });
}

http.createServer((req, res) => {
  handle(req, res).catch(err => json(res, 500, { error: err.message }));
}).listen(PORT, () => {
  console.log(`MOD AI proxy listening on http://localhost:${PORT}`);
});
