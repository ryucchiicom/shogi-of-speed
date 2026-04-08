// server.js
const http = require("node:http");

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const MOD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    modName: { type: "string" },
    summary: { type: "string" },
    config: {
      type: "object",
      additionalProperties: false,
      properties: {
        moveCooldownMs: { type: "integer" },
        handCooldownMs: { type: "integer" },
        showHints: { type: "boolean" },
        boardDark: { type: "string" },
        boardLight: { type: "string" },
        piece1: { type: "string" },
        piece2: { type: "string" },
        cpuAggression: { type: "number" },
        cpuExploration: { type: "number" }
      },
      required: [
        "moveCooldownMs",
        "handCooldownMs",
        "showHints",
        "boardDark",
        "boardLight",
        "piece1",
        "piece2",
        "cpuAggression",
        "cpuExploration"
      ]
    }
  },
  required: ["modName", "summary", "config"]
};

function send(res, code, body, type = "text/plain; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type });
  res.end(body);
}

function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function collect(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", d => {
      buf += d;
      if (buf.length > 1e6) {
        req.destroy();
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => resolve(buf));
    req.on("error", reject);
  });
}

async function openaiModAI({ mode, name, prompt, current, history }) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY が設定されていないよ");
  }

  const system = [
    "あなたは将棋風ゲームのMOD設計AI。",
    "出力は必ずJSONだけ。",
    "MODは安全な設定変更に限定する。",
    "コードを生成しない。",
    "プレイに影響する設定だけを調整する。",
    "moveCooldownMs, handCooldownMs, showHints, boardDark, boardLight, piece1, piece2, cpuAggression, cpuExploration を扱う。",
    "色はCSSで使える文字列にする。",
    "小さな改善でもよいが、JSON Schemaに厳密に従う。"
  ].join(" ");

  const user = {
    mode,
    name,
    prompt,
    current,
    history: Array.isArray(history) ? history.slice(-10) : []
  };

  const body = {
    model: OPENAI_MODEL,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: system }]
      },
      {
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify(user) }]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        strict: true,
        schema: MOD_SCHEMA
      }
    }
  };

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error?.message || `OpenAI error ${r.status}`;
    throw new Error(msg);
  }

  const text = data.output_text || "";
  if (!text) throw new Error("OpenAIから本文が返らなかったよ");
  return JSON.parse(text);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/api/mod-ai" && req.method === "POST") {
      const raw = await collect(req);
      const payload = raw ? JSON.parse(raw) : {};
      const out = await openaiModAI(payload);
      return sendJson(res, 200, out);
    }

    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      const fs = require("node:fs");
      const path = require("node:path");
      const file = path.join(process.cwd(), "index.html");
      if (fs.existsSync(file)) {
        return send(res, 200, fs.readFileSync(file, "utf8"), "text/html; charset=utf-8");
      }
      return send(res, 404, "index.html が見つからないよ");
    }

    return send(res, 404, "Not found");
  } catch (e) {
    return sendJson(res, 500, { error: e.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
