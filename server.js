// server.js
import http from "node:http";

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

function send(res, code, data, contentType = "application/json; charset=utf-8") {
  res.writeHead(code, { "Content-Type": contentType });
  res.end(typeof data === "string" ? data : JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

async function generateMod({ name, prompt, previous }) {
  if (!OPENAI_API_KEY) {
    return {
      manifest: {
        name,
        version: 1,
        description: "OPENAI_API_KEY が未設定なので、ローカルのダミー生成になってる。",
        settings: {
          cooldownMs: 3000,
          cpuAggression: 1,
          handRotate180: true
        }
      },
      description: "OPENAI_API_KEY が未設定なので、ローカルのダミー生成になってる。"
    };
  }

  const system = `
You create private mod manifests for a shogi-like web game.
Return ONLY valid JSON.
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
- Use Japanese.
- Keep values practical.
- cooldownMs 500..15000.
- cpuAggression 0.2..5.
`;

  const payload = {
    model: OPENAI_MODEL,
    input: [
      { role: "system", content: [{ type: "input_text", text: system }] },
      { role: "user", content: [{ type: "input_text", text: JSON.stringify({ name, prompt, previous }, null, 2) }] }
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
    throw new Error(`OpenAI error ${resp.status}: ${await resp.text()}`);
  }

  const data = await resp.json();
  const text = data.output_text || "";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("OpenAI の出力が JSON じゃなかった。");
  }

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
      const out = await generateMod({ name, prompt, previous });
      send(res, 200, out);
    } catch (err) {
      send(res, 500, { error: err.message || "server error" });
    }
    return;
  }

  send(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`server listening on http://localhost:${PORT}`);
});
