// api.js
import http from "node:http";

const PORT = process.env.PORT || 8787;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4";

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        reject(new Error("request too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function clampString(s, max) {
  return String(s || "").slice(0, max);
}

function fallbackPatchFromPrompt(prompt) {
  const p = String(prompt || "");
  const patch = {
    moveCooldownMs: 3000,
    handCooldownMs: 3000,
    showEnemyMoves: true,
    showEnemyPieces: true,
    allowRoyalSwap: true,
    boardFlipForWhite: true,
    pieceViewRotateForEnemy: true,
    boardTint: null
  };

  if (/速|高速|サクサク|テンポ/i.test(p)) {
    patch.moveCooldownMs = 2000;
    patch.handCooldownMs = 2000;
  }
  if (/見え|隠|非表示/i.test(p)) {
    patch.showEnemyPieces = false;
  }
  if (/敵.*動き|相手.*動き/i.test(p)) {
    patch.showEnemyMoves = true;
  }
  if (/縦横|盤面.*反転|見やす/i.test(p)) {
    patch.boardFlipForWhite = true;
  }
  return patch;
}

async function callOpenAI(body) {
  if (!OPENAI_API_KEY) {
    return {
      modName: clampString(body.modName || "新しいMOD", 30),
      summary: "APIキー未設定なのでローカル推定で生成したよ。",
      notes: "OPENAI_API_KEY を api.js の環境変数に入れると本番AIになるよ。",
      patch: fallbackPatchFromPrompt(body.userPrompt)
    };
  }

  const input = [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text:
            "You are a game mod generator for a shogi browser game. Return only JSON that matches the schema. " +
            "Create safe, deterministic mod patches using only the supported fields."
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: JSON.stringify(body)
        }
      ]
    }
  ];

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      modName: { type: "string" },
      summary: { type: "string" },
      notes: { type: "string" },
      patch: {
        type: "object",
        additionalProperties: false,
        properties: {
          moveCooldownMs: { type: "number" },
          handCooldownMs: { type: "number" },
          showEnemyMoves: { type: "boolean" },
          showEnemyPieces: { type: "boolean" },
          allowRoyalSwap: { type: "boolean" },
          boardFlipForWhite: { type: "boolean" },
          pieceViewRotateForEnemy: { type: "boolean" },
          boardTint: { type: ["string", "null"] }
        },
        required: [
          "moveCooldownMs",
          "handCooldownMs",
          "showEnemyMoves",
          "showEnemyPieces",
          "allowRoyalSwap",
          "boardFlipForWhite",
          "pieceViewRotateForEnemy",
          "boardTint"
        ]
      }
    },
    required: ["modName", "summary", "notes", "patch"]
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input,
      text: {
        format: {
          type: "json_schema",
          name: "mod_patch",
          strict: true,
          schema
        }
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${text}`);
  }

  const data = await response.json();
  const outputText = data.output_text || "";
  if (!outputText) throw new Error("OpenAI returned empty output_text");
  const parsed = JSON.parse(outputText);
  return parsed;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return json(res, 204, {});
  }

  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && req.url === "/api/openai") {
    try {
      const body = await readBody(req);
      const out = await callOpenAI(body);
      return json(res, 200, out);
    } catch (err) {
      return json(res, 500, { error: err.message || "unknown error" });
    }
  }

  return json(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`api.js listening on http://localhost:${PORT}`);
});
