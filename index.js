const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const VERIFY_TOKEN = "eden_verify_123";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const sessions = {};
const alertedSessions = {};
const clinicProfiles = {};

const SYSTEM_PROMPT = `
You are Eden Clinic Network's AI Clinic Growth Auditor.

You help clinic owners discover hidden lost revenue from missed calls, slow replies, weak follow-up, poor booking conversion, unclear offers, weak trust signals, and overloaded staff.

Core personality:
You are not a survey bot.
You are a warm human-style clinic growth advisor.
Sound like a real person chatting with a clinic owner.
Be calm, practical, observant, and commercially sharp.
Use simple, natural English suitable for clinic owners in the Philippines.
Avoid perfect corporate language.

Conversation style:
Use short chat-style replies.
Usually 1-3 short lines.
Sometimes just one sentence.
Do not over-explain.
Do not sound like a form.
React naturally to what the user just said before asking the next question.
Ask only ONE simple next-step question.
Vary your wording.
Do not repeat the same phrases.

Philippines localization:
Use Philippine-friendly English.
If the user uses Tagalog or Cebuano, lightly mirror with 1-3 natural words, then continue in English.
Examples:
"Got it po."
"Sige."
"Salamat."
"Okay, makes sense."
"Mao ni."
Do not overdo local language.
Do not pretend to be Filipino.

Formatting:
When useful, split your reply into 2-3 short paragraphs separated by blank lines.
Do not use bullet points unless giving the final audit summary.

Goal:
Guide the clinic owner through a short clinic growth audit.
Remember what they already told you.
Identify their biggest patient/revenue leak.
Estimate missed bookings when enough information is available.
Build trust in Eden's AI + Human Team system.

Only ask for name and WhatsApp/email when the clinic owner shows strong interest, such as asking about pricing, setup, implementation, or saying they want Eden's help.
`;

function hasLeadSignal(text) {
  const lower = text.toLowerCase();

  const hasEmail = /[^\s@]+@[^\s@]+\.[^\s@]+/.test(text);
  const hasPhone = /(\+?\d[\d\s().-]{7,}\d)/.test(text);

  const hasIntent =
    lower.includes("interested") ||
    lower.includes("how much") ||
    lower.includes("pricing") ||
    lower.includes("price") ||
    lower.includes("setup") ||
    lower.includes("start") ||
    lower.includes("help us") ||
    lower.includes("contact") ||
    lower.includes("whatsapp") ||
    lower.includes("email");

  return hasEmail || hasPhone || hasIntent;
}

function formatTranscript(session) {
  return session
    .map(item => `${item.role.toUpperCase()}: ${item.content}`)
    .join("\n\n");
}

function ensureProfile(sessionId) {
  if (!clinicProfiles[sessionId]) {
    clinicProfiles[sessionId] = {
      clinicName: "",
      city: "",
      clinicType: "",
      website: "",
      whatsapp: "",
      email: ""
    };
  }
}

function updateProfileFromText(sessionId, text) {
  ensureProfile(sessionId);

  const profile = clinicProfiles[sessionId];

  const emailMatch = text.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  if (emailMatch) profile.email = emailMatch[0];

  const phoneMatch = text.match(/(\+?\d[\d\s().-]{7,}\d)/);
  if (phoneMatch) profile.whatsapp = phoneMatch[0];
}

function getProfileContext(sessionId) {
  ensureProfile(sessionId);

  const p = clinicProfiles[sessionId];

  return `
Clinic name: ${p.clinicName || "Unknown"}
City: ${p.city || "Unknown"}
Clinic type: ${p.clinicType || "Unknown"}
Website: ${p.website || "Unknown"}
WhatsApp: ${p.whatsapp || "Unknown"}
Email: ${p.email || "Unknown"}
`;
}

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("Telegram env vars missing.");
    return;
  }

  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: text.slice(0, 3900)
    })
  });
}

async function createLeadSummary(session) {
  try {
    const transcript = formatTranscript(session);

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + OPENAI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: `
Create a short internal lead summary for Eden Clinic Network.

Return:
Clinic:
City:
Clinic type:
Contact details:
Main problems:
Estimated opportunity:
Buying intent score 1-10:
Recommended follow-up:

If unknown, write Unknown.
`
          },
          {
            role: "user",
            content: transcript
          }
        ]
      })
    });

    const data = await response.json();

    return (
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      "Lead summary unavailable."
    ).trim();
  } catch (error) {
    console.error("Lead summary error:", error);
    return "Lead summary unavailable.";
  }
}

async function maybeSendLeadAlert(sessionId, latestUserText) {
  if (alertedSessions[sessionId]) return;
  if (!hasLeadSignal(latestUserText)) return;

  alertedSessions[sessionId] = true;

  const session = sessions[sessionId] || [];
  const summary = await createLeadSummary(session);
  const transcript = formatTranscript(session);

  const message = `
🔥 NEW CLINIC AUDIT LEAD

Session:
${sessionId}

SUMMARY
${summary}

FULL TRANSCRIPT
--------------------
${transcript}
`;

  await sendTelegram(message);
}

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified!");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  console.log("Incoming webhook:", JSON.stringify(req.body, null, 2));

  try {
    const messagingEvents = req.body.entry?.[0]?.messaging || [];

    for (const messaging of messagingEvents) {
      if (!messaging?.sender?.id || !messaging?.message?.text) continue;

      const senderId = messaging.sender.id;
      const userText = messaging.message.text;

      const aiReply = await getAIReply(userText, senderId);
      await sendMessage(senderId, aiReply);
    }
  } catch (error) {
    console.error("Webhook error:", error);
  }

  res.sendStatus(200);
});

async function getAIReply(userText, sessionId = "default") {
  try {
    if (!sessions[sessionId]) {
      sessions[sessionId] = [];
    }

    if (!clinicProfiles[sessionId]) {
  clinicProfiles[sessionId] = {
    clinicName: "",
    city: "",
    clinicType: "",
    website: "",
    whatsapp: "",
    email: ""
  };
    }

    updateProfileFromText(sessionId, userText);

    sessions[sessionId].push({
      role: "user",
      content: userText
    });

    sessions[sessionId] = sessions[sessionId].slice(-50);

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + OPENAI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          ...sessions[sessionId]
        ]
      })
    });

    const data = await response.json();
    console.log("OpenAI response:", JSON.stringify(data, null, 2));

    let reply =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      data.output?.[1]?.content?.[0]?.text;

    if (!reply || reply.trim() === "") {
      reply = "Got you 😊 what would you like help with?";
    }

    sessions[sessionId].push({
      role: "assistant",
      content: reply
    });

    sessions[sessionId] = sessions[sessionId].slice(-50);

    await maybeSendLeadAlert(sessionId, userText);

    return reply.trim();
  } catch (error) {
    console.error("OpenAI error:", error);
    return "One sec 😊 let me check that for you.";
  }
}

async function sendMessage(senderId, text) {
  if (!text || text.trim() === "") {
    text = "Hi 😊 how can I help you today?";
  }

  const response = await fetch(
    `https://graph.facebook.com/v25.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: senderId },
        message: { text }
      })
    }
  );

  const data = await response.json();
  console.log("Send response:", data);
}

app.post("/eleven-postcall", async (req, res) => {
  try {
    const data = req.body;

    const transcript =
      data.transcript ||
      data.conversation_transcript ||
      JSON.stringify(data, null, 2);

    const message = `
🦷 AI Call Completed

Clinic: Glow Dental Cebu
Status: Needs clinic confirmation

📞 Caller: ${data.caller_id || data.phone_number || "Unknown"}

📝 Transcript:
${transcript.slice(0, 3000)}
`;

    await sendTelegram(message);

    res.status(200).send("ok");
  } catch (err) {
    console.error(err);
    res.status(500).send("error");
  }
});

app.get("/test-telegram", async (req, res) => {
  try {
    await sendTelegram("✅ Eden Telegram test alert works.");
    res.send("Telegram test sent");
  } catch (err) {
    console.error("Telegram test error:", err);
    res.status(500).send("Telegram test failed");
  }
});

app.post("/chat", async (req, res) => {
  try {
    const userText = req.body.message || "";
    const sessionId = req.body.sessionId || "website-default";

    if (!userText.trim()) {
      return res.json({ reply: "Hi 😊 What is your clinic name and website?" });
    }

    const reply = await getAIReply(userText, sessionId);
    res.json({ reply });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ reply: "One sec 😊 let me check that for you." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
