// server.js
import http from "node:http";

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "";

function send(res, code, data, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type });
  res.end(typeof data === "string" ? data : JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", c => {
      body += c;
      if (body.length > 1_000_000) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function serveIndex(res) {
  send(res, 200, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><p>index.html を同じフォルダに置いて静的配信するか、好きなホスティングに載せてね。</p></body></html>`, "text/html; charset=utf-8");
}

async function generateModManifest({ name, prompt, previous }) {
  if (!OPENAI_API_KEY || !OPENAI_MODEL) {
    return {
      manifest: {
        name,
        version: 1,
        description: "サーバー未設定のためローカル生成になってる。",
        settings: {
          cooldownMs: 3000,
          cpuAggression: 1,
          boardDark: null,
          boardLight: null,
          pieceFill1: null,
          pieceFill2: null,
          handRotate180: true
        }
      },
      description: "サーバー未設定のためローカル生成になってる。"
    };
  }

  const system = `
You create private game MOD manifests for a shogi-like web game.

Return ONLY valid JSON, no markdown, no code fences.
Schema:
{
  "name": string,
  "version": number,
  "description": string,
  "settings": {
    "cooldownMs"?: number,
    "cpuAggression"?: number,
    "boardDark"?: string,
    "boardLight"?: string,
    "pieceFill1"?: string,
    "pieceFill2"?: string,
    "handRotate180"?: boolean
  }
}

Rules:
- Keep settings practical.
- cooldownMs should be between 500 and 15000 if present.
- cpuAggression should be between 0.2 and 5 if present.
- Use Japanese description.
- Make it consistent with the user's prompt.
`;

  const user = {
    name,
    prompt,
    previous: previous || null
  };

  const payload = {
    model: OPENAI_MODEL,
    input: [
      { role: "system", content: [{ type: "input_text", text: system }] },
      { role: "user", content: [{ type: "input_text", text: JSON.stringify(user, null, 2) }] }
    ]
  };

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  const text = data.output_text || "";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("OpenAI output was not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object") throw new Error("Bad OpenAI JSON.");
  parsed.name = String(parsed.name || name);
  parsed.version = Number.isFinite(parsed.version) ? parsed.version : 1;
  parsed.description = String(parsed.description || "");
  parsed.settings = parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {};
  return { manifest: parsed, description: parsed.description };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "POST" && url.pathname === "/api/mods/generate") {
    try {
      const body = await readBody(req);
      const name = String(body.name || "新しいMOD").trim().slice(0, 64);
      const prompt = String(body.prompt || "").trim().slice(0, 5000);
      const previous = body.previous && typeof body.previous === "object" ? body.previous : null;
      const out = await generateModManifest({ name, prompt, previous });
      send(res, 200, out);
    } catch (err) {
      send(res, 500, { error: err.message || "server error" });
    }
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return serveIndex(res);
  }

  send(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`server listening on http://localhost:${PORT}`);
});
