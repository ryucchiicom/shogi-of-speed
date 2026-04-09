// server.js
// Node 18+ 想定
// 使い方:
//   OPENAI_API_KEY=sk-... OPENAI_MODEL=gpt-5.4 node server.js
//   そのあと http://localhost:3000 を開く

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4";

const indexHtmlPath = path.join(__dirname, "index.html");

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function systemPrompt(mode) {
  if (mode === "revise") {
    return `
あなたはMOD修正AIです。
必ずJSONだけを返してください。
目的は、既存MODのバグ修正・追加要素・調整です。

返すJSON形式:
{
  "name": "MOD名",
  "summary": "短い説明",
  "versionNotes": "この版で何を変えたか",
  "rules": {
    "cooldownMs": number,
    "boardDark": "#hex",
    "boardLight": "#hex",
    "pieceLabelOverrides": { "pawn": "歩" },
    "extra": "自由文"
  }
}

ルール:
- 既存の意図をなるべく壊さない
- 変更は具体的で、ゲームに反映しやすい形にする
- JSON以外は出さない
`.trim();
  }

  return `
あなたはMOD生成AIです。
必ずJSONだけを返してください。
入力文をもとに、ゲームMODの内容を設計してください。

返すJSON形式:
{
  "name": "MOD名",
  "summary": "短い説明",
  "versionNotes": "この版の説明",
  "rules": {
    "cooldownMs": number,
    "boardDark": "#hex",
    "boardLight": "#hex",
    "pieceLabelOverrides": { "pawn": "歩" },
    "extra": "自由文"
  }
}

ルール:
- 小文字英字は必要なら大文字化してよい
- ひらがなは使ってよい
- なるべく実装しやすいルールにする
- JSON以外は出さない
`.trim();
}

async function callOpenAI({ mode, name, prompt, previous }) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY が設定されていない");
  }

  const inputText = mode === "revise"
    ? `既存MOD名: ${name}\n\n修正要望:\n${prompt}\n\n前バージョン情報:\n${JSON.stringify(previous || {}, null, 2)}`
    : `MOD名候補: ${name}\n\n作りたいMODの説明:\n${prompt}`;

  const body = {
    model: OPENAI_MODEL,
    input: [
      { role: "system", content: systemPrompt(mode) },
      { role: "user", content: inputText }
    ],
    reasoning: { effort: "low" }
  };

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`OpenAI API error ${resp.status}: ${text}`);
  }

  const data = JSON.parse(text);
  const outputText = data.output_text || "";
  const jsonStart = outputText.indexOf("{");
  const jsonEnd = outputText.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < 0 || jsonEnd <= jsonStart) {
    throw new Error("AIの返答がJSONではなかった");
  }
  const parsed = JSON.parse(outputText.slice(jsonStart, jsonEnd + 1));
  return parsed;
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && parsedUrl.pathname === "/") {
    const html = fs.readFileSync(indexHtmlPath, "utf8");
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(html);
    return;
  }

  if (req.method === "GET" && parsedUrl.pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && parsedUrl.pathname === "/api/mod-ai") {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}");
      const mode = body.mode === "revise" ? "revise" : "create";
      const name = String(body.name || "").slice(0, 120);
      const prompt = String(body.prompt || "").slice(0, 6000);
      const previous = body.previous && typeof body.previous === "object" ? body.previous : null;

      if (!name || !prompt) {
        return sendJson(res, 400, { error: "name と prompt が必要" });
      }

      const result = await callOpenAI({ mode, name, prompt, previous });
      sendJson(res, 200, { ok: true, result });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (req.method === "GET" && parsedUrl.pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  send(res, 404, "Not Found");
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
