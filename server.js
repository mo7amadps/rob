require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-3.5-flash";

// -----------------------------------------------------------------------
// Health check - useful to confirm the server is up before wiring the URL
// into the Roblox plugin.
// -----------------------------------------------------------------------
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Animation AI server is running." });
});

// -----------------------------------------------------------------------
// Main endpoint the Roblox plugin calls:
//   POST {apiUrl}/api/animation-ai/generate
// Body: { prompt, rigName, joints: [{name, parent}], duration, fps }
// Must return: { plan: { duration, fps, keyframes: [...], notes } }
// -----------------------------------------------------------------------
app.post("/api/animation-ai/generate", async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY غير مضبوط على السيرفر." });
    }

    const { prompt, rigName, joints, duration, fps } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "الحقل prompt مطلوب." });
    }
    if (!Array.isArray(joints) || joints.length === 0) {
      return res.status(400).json({ error: "الحقل joints مطلوب ويجب أن يحتوي على مفصل واحد على الأقل." });
    }

    const jointNames = joints.map((j) => j.name);
    const safeDuration = clamp(Number(duration) || 3, 0.1, 60);
    const safeFps = clamp(Math.floor(Number(fps) || 24), 1, 60);

    const systemPrompt = buildSystemPrompt(jointNames, safeDuration, safeFps);
    const userPrompt = `Rig name: ${rigName || "Unknown"}\nAnimation description: ${prompt}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              duration: { type: "NUMBER" },
              fps: { type: "NUMBER" },
              keyframes: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    time: { type: "NUMBER" },
                    poses: {
                      type: "ARRAY",
                      items: {
                        type: "OBJECT",
                        properties: {
                          joint: { type: "STRING" },
                          position: {
                            type: "ARRAY",
                            items: { type: "NUMBER" },
                            minItems: 3,
                            maxItems: 3,
                          },
                          rotation: {
                            type: "ARRAY",
                            items: { type: "NUMBER" },
                            minItems: 3,
                            maxItems: 3,
                          },
                        },
                        required: ["joint", "position", "rotation"],
                      },
                    },
                  },
                  required: ["time", "poses"],
                },
              },
              notes: { type: "STRING" },
            },
            required: ["duration", "fps", "keyframes", "notes"],
          },
          maxOutputTokens: 8192,
          thinkingConfig: { thinkingLevel: "low" },
        },
      }),
    });

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      console.error("Gemini API error:", geminiResponse.status, errText);
      return res.status(502).json({ error: "فشل الاتصال بخدمة الذكاء الاصطناعي." });
    }

    const geminiData = await geminiResponse.json();
    const candidateText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) {
      console.error("Unexpected Gemini response shape:", JSON.stringify(geminiData));
      return res.status(502).json({ error: "لم يرجع النموذج أي نص." });
    }

    const cleaned = candidateText.replace(/```json|```/g, "").trim();
    let plan;
    try {
      plan = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr, cleaned);
      return res.status(502).json({ error: "تعذّر فهم استجابة النموذج." });
    }

    const validationError = validatePlan(plan, jointNames);
    if (validationError) {
      return res.status(502).json({ error: validationError });
    }

    return res.json({ plan });
  } catch (err) {
    console.error("Unexpected server error:", err);
    return res.status(500).json({ error: "خطأ غير متوقع بالسيرفر." });
  }
});

function buildSystemPrompt(jointNames, duration, fps) {
  return [
    "You generate keyframe animation plans for a Roblox rig.",
    "You must respond with ONLY raw JSON, no prose, no markdown fences.",
    "The JSON must match exactly this shape:",
    "{",
    '  "duration": number,',
    '  "fps": number,',
    '  "keyframes": [',
    '    { "time": number, "poses": [ { "joint": string, "position": [number, number, number], "rotation": [number, number, number] } ] }',
    "  ],",
    '  "notes": string',
    "}",
    "",
    `Only use joint names from this exact list (case-sensitive): ${jointNames.join(", ")}`,
    `Use duration=${duration} and fps=${fps} unless the description clearly implies a different pacing (still respect the joint list).`,
    "position is a local offset in studs [x,y,z]. rotation is in degrees [x,y,z].",
    "Include at least 2 keyframes (start and end pose) and as many in between as needed for a smooth, natural motion.",
    "Keep rotation values realistic for a humanoid rig (avoid extreme values beyond +/-180 unless clearly required).",
  ].join("\n");
}

function validatePlan(plan, jointNames) {
  if (!plan || typeof plan !== "object") return "الاستجابة ليست كائن JSON صالح.";
  if (!Array.isArray(plan.keyframes) || plan.keyframes.length < 2) {
    return "يجب أن تحتوي الخطة على مؤطرين (keyframes) على الأقل.";
  }
  const jointSet = new Set(jointNames);
  for (const frame of plan.keyframes) {
    if (typeof frame.time !== "number" || !Array.isArray(frame.poses)) {
      return "بنية أحد المؤطرات غير صحيحة.";
    }
    for (const pose of frame.poses) {
      if (!jointSet.has(pose.joint)) {
        return `مفصل غير معروف في الاستجابة: ${pose.joint}`;
      }
      if (!Array.isArray(pose.position) || pose.position.length !== 3) {
        return `position غير صحيح للمفصل: ${pose.joint}`;
      }
      if (!Array.isArray(pose.rotation) || pose.rotation.length !== 3) {
        return `rotation غير صحيح للمفصل: ${pose.joint}`;
      }
    }
  }
  return null;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

app.listen(PORT, () => {
  console.log(`Animation AI server listening on port ${PORT}`);
});
