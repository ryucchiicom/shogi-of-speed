// server.js
// 使い方:
//   1) OPENAI_API_KEY を環境変数に入れる
//   2) node server.js
//   3) index.html から /api/mod-ai を叩く
//
// OpenAI は API キーをブラウザに置かないよう明言しています。
// Responses API が現在の生成用APIです。 [oai_citation:1‡OpenAI Help Center](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety?utm_source=chatgpt.com)

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

function send(res, status, body, headers = {}) {
  const isObj = typeof body === "object" && body !== null;
  res.writeHead(status, {
    "Content-Type": isObj ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    ...headers
  });
  res.end(isObj ? JSON.stringify(body) : String(body));
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("AI output was not JSON");
    return JSON.parse(m[0]);
  }
}

async function handleModAI(req, res) {
  if (!OPENAI_API_KEY) {
    send(res, 500, { error: "OPENAI_API_KEY is missing" });
    return;
  }

  let body = "";
  req.on("data", chunk => body += chunk);
  req.on("end", async () => {
    try {
      const input = JSON.parse(body || "{}");
      const mode = input.mode === "edit" ? "edit" : "create";
      const name = String(input.name || "NEWMOD").slice(0, 40);
      const prompt = String(input.prompt || "").slice(0, 4000);
      const existing = input.existing || null;
      const versions = Array.isArray(input.versions) ? input.versions.slice(-8) : [];

      const system = `
あなたはMOD設計者です。
返答は必ずJSONのみ。
形式:
{
  "name":"MOD名",
  "summary":"短い説明",
  "patchNote":"何を変えたかの説明",
  "runtime":{
    "cooldownMs":3000,
    "boardTint":"optional",
    "pieceTint":"optional",
    "rules": {
      "example": "optional"
    }
  }
}
runtime にはゲーム本体が読むための軽い設定だけ入れる。
日本語でわかりやすく。
`;

      const user = {
        mode,
        name,
        prompt,
        existing,
        versions
      };

      const r = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          input: [
            { role: "system", content: [{ type: "input_text", text: system }] },
            { role: "user", content: [{ type: "input_text", text: JSON.stringify(user, null, 2) }] }
          ]
        })
      });

      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || `OpenAI error ${r.status}`);
      }

      const data = await r.json();

      let text = "";
      const out = data.output || [];
      for (const item of out) {
        for (const c of (item.content || [])) {
          if (c.type === "output_text" && typeof c.text === "string") text += c.text;
        }
      }

      const parsed = safeJsonParse(text);
      send(res, 200, parsed);
    } catch (err) {
      send(res, 500, { error: err.message });
    }
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    send(res, 204, "", {
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    return;
  }

  if (url.pathname === "/api/mod-ai" && req.method === "POST") {
    await handleModAI(req, res);
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    try {
      const html = await readFile(join(process.cwd(), "index.html"), "utf8");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(html);
    } catch (err) {
      send(res, 500, `index.html not found: ${err.message}`);
    }
    return;
  }

  send(res, 404, "Not found");
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
