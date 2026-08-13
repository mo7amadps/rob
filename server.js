require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-5";

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
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY غير مضبوط على السيرفر." });
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

    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text();
      console.error("Anthropic API error:", claudeResponse.status, errText);
      return res.status(502).json({ error: "فشل الاتصال بخدمة الذكاء الاصطناعي." });
    }

    const claudeData = await claudeResponse.json();
    const textBlock = (claudeData.content || []).find((b) => b.type === "text");
    if (!textBlock) {
      return res.status(502).json({ error: "لم يرجع النموذج أي نص." });
    }

    const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
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
