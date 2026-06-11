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
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

const sessions = {};
const alertedSessions = {};
const leadAlertSnapshots = {};
const contactUpdatedSessions = {};
const clinicProfiles = {};
const auditPreviewHtmlBySession = {};
const websiteFindingsBySession = {};

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
Keep explanations short and practical.
When discussing revenue or lost bookings, briefly show the reasoning.
Do not sound like a form.
React naturally to what the user just said before asking the next question.
Ask only ONE simple next-step question.
If you need multiple pieces of information, ask for them one at a time.
Do not combine multiple questions in the same message unless they are tightly connected and can be answered with a single number or short reply.
Vary your wording.
Do not repeat the same phrases.
Use confidence language. Examples:
"Based on what you've shared..."
"A rough estimate would be..."
"If your numbers are accurate..."
"This appears to be..."
Avoid vague phrases such as:
"worth thousands"
"many bookings"
"quite a few patients"
Whenever possible, replace vague statements with simple numerical ranges.

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
Before recommending Eden's solution, first help the clinic owner understand the size of the problem using their own numbers whenever possible.

Reasoning:
When discussing potential recovered bookings:
If the clinic has provided numbers, explain the estimate using those numbers.
If the clinic has not provided numbers, clearly label any estimate as a benchmark, industry assumption, or rough example.
Never present assumptions as facts about the clinic.
Use confidence language such as:
"Based on what you've shared..."
"A rough estimate would be..."
"If those numbers are accurate..."
When explaining revenue leakage, use short visible reasoning.
Reasoning format:
1. Mention the clinic's own number.
2. Show one simple implication.
3. Show the estimated value.
4. Keep it under 3 short sentences.

Example:
"You mentioned 8–10 missed calls and 15–20 late replies weekly. Even recovering 3–5 bookings could mean roughly ₱13,500–₱22,500 per week at your ₱4,500 average booking value. That is why follow-up is the first fix I'd prioritize."

Avoid vague phrases such as:
"worth thousands"
"many bookings"
"quite a few patients"

Use numerical ranges whenever possible.
Before asking about Eden's service, help the clinic owner reach their own conclusion that revenue is being lost.

Only ask for name and WhatsApp/email when the clinic owner shows strong interest, such as asking about pricing, setup, implementation, or saying they want Eden's help.
`;

function ensureProfile(sessionId) {
  if (!clinicProfiles[sessionId]) {
    clinicProfiles[sessionId] = {
      clinicName: "",
      city: "",
      clinicType: "",
      website: "",
      whatsapp: "",
      email: "",
      buyingIntent: ""
    };
  }
}

function updateProfileFromText(sessionId, text) {
  ensureProfile(sessionId);

  const profile = clinicProfiles[sessionId];
  const lower = text.toLowerCase();

  const emailMatch = text.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  if (emailMatch) profile.email = emailMatch[0];

  const phoneMatch = text.match(/(\+?\d[\d\s().-]{7,}\d)/);
  if (phoneMatch) profile.whatsapp = phoneMatch[0];

  const websiteMatch = text.match(/(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.(com|ph|net|org|clinic|live)[^\s]*)/i);
  if (websiteMatch) profile.website = websiteMatch[0];

  const clinicPatterns = [
/i run ([^.\n,]+)/i,
/i own ([^.\n,]+)/i,
/i manage ([^.\n,]+)/i,
/clinic[:\s]+([^.\n,]+)/i,
/clinic name ([^.\n,]+)/i,
/name ([^.\n,]+)/i,
/clinic name(?: is)? ([^.\n,]+)/i,
/from a clinic called ([^.\n,]+)/i,
/clinic called ([^.\n,]+)/i,
/called ([^.\n,]+)/i,
/i am .+? from ([^.\n,]+)/i,
/i'm .+? from ([^.\n,]+)/i,
];
    
const fbMatch =
  text.match(/our facebook page is ([^.\n,]+)/i) ||
  text.match(/facebook page is ([^.\n,]+)/i) ||
  text.match(/fb is ([^.\n,]+)/i) ||
  text.match(/fb[:\s]+([^.\n,]+)/i) ||
  text.match(/facebook[:\s]+([^.\n,]+)/i);

if (fbMatch && fbMatch[1]) {
  const fb = fbMatch[1].trim();

  const badFacebookWords = [
  "auto",
  "responder",
  "reply",
  "message limit",
  "messages",
  "follow-up",
  "manual",
  "whatsapp",
  "email",
  "unknown",
  "contact details"
];

const looksBad = badFacebookWords.some(word =>
  fb.toLowerCase().includes(word)
);

if (
  fb.length >= 3 &&
  fb.length <= 60 &&
  !looksBad
) {
  profile.facebook = fb;
}
}
  for (const pattern of clinicPatterns) {
  const match = text.match(pattern);

if (match && match[1]) {
  let candidate = match[1].trim();

  candidate = candidate
    .replace(/\bfb\b/gi, "")
    .replace(/\bfacebook\b/gi, "")
    .replace(/\bpage\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (candidate.length >= 3 && candidate.length <= 80) {
    profile.clinicName = candidate;
    break;
  }
}
  }   
  const p = clinicProfiles[sessionId];

if (p) {
  for (const key of ["clinicName", "city", "clinicType", "website", "facebook", "whatsapp", "email", "buyingIntent", "mainPainPoint"]) {
    if (typeof p[key] === "string") {
      p[key] = p[key].replace(/[;,]+$/g, "").trim();
    }
  }

  if (p.email && p.website) {
    const emailDomain = p.email.split("@")[1]?.toLowerCase();
    const websiteClean = p.website.replace(/^https?:\/\//, "").replace(/^www\./, "").toLowerCase();

    if (emailDomain && websiteClean === emailDomain) {
      p.website = "";
    }
  }

  const typeText = `${p.clinicName || ""} ${p.clinicType || ""}`.toLowerCase();

  if (typeText.includes("dental") || typeText.includes("dentist") || typeText.includes("orthodont")) {
    p.clinicType = "Dental clinic";
  }
}
  if (lower.includes("cebu")) profile.city = "Cebu";
  if (lower.includes("manila")) profile.city = "Manila";
  if (lower.includes("davao")) profile.city = "Davao";
  if (lower.includes("makati")) profile.city = "Makati";
  if (lower.includes("quezon")) profile.city = "Quezon City";
  if (lower.includes("pattaya")) profile.city = "Pattaya";
  if (lower.includes("bangkok")) profile.city = "Bangkok";

  if (lower.includes("dental") || lower.includes("dentist")) profile.clinicType = "Dental clinic";
  if (lower.includes("aesthetic") || lower.includes("beauty")) profile.clinicType = "Aesthetic clinic";
  if (lower.includes("derma") || lower.includes("skin")) profile.clinicType = "Dermatology clinic";
  if (lower.includes("medical clinic")) profile.clinicType = "Medical clinic";

  if (
    lower.includes("interested") ||
    lower.includes("pricing") ||
    lower.includes("price") ||
    lower.includes("setup") ||
    lower.includes("start") ||
    lower.includes("help")
  ) {
    profile.buyingIntent = "Interested";
  }
}

function normalizeWebsiteUrl(url) {
  if (!url) return "";

  let clean = url.trim().replace(/[),.]+$/g, "");

  if (!/^https?:\/\//i.test(clean)) {
    clean = "https://" + clean;
  }

  return clean;
}

async function analyzeClinicWebsite(url) {
  try {
    const normalizedUrl = normalizeWebsiteUrl(url);

    const response = await fetch(normalizedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 EdenClinicAuditBot"
      }
    });

    const html = await response.text();

    const visibleText = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 12000);

    const phoneVisible =
      /(\+?\d[\d\s().-]{7,}\d)/.test(visibleText);

    const bookingCtaVisible =
      /(book|appointment|schedule|reserve|consultation|inquire|contact us|get started)/i.test(visibleText);

    const messengerWhatsappVisible =
      /(messenger|facebook\.com|m\.me|whatsapp|wa\.me)/i.test(html);

    const trustSignalsVisible =
      /(review|reviews|testimonial|testimonials|before and after|doctor|licensed|certified|years|patients|rating|award)/i.test(visibleText);

    return {
      reviewedUrl: normalizedUrl,
      phoneVisible,
      bookingCtaVisible,
      messengerWhatsappVisible,
      trustSignalsVisible,
      textSample: visibleText.slice(0, 2000)
    };

  } catch (error) {
    console.error("Website analysis error:", error.message);

    return {
      error: true,
      message: "Website could not be reviewed automatically."
    };
  }
}
function getProfileContext(sessionId) {
  ensureProfile(sessionId);
  const p = clinicProfiles[sessionId];

  return `
Known clinic information:
Clinic name: ${p.clinicName || "Unknown"}
City: ${p.city || "Unknown"}
Clinic type: ${p.clinicType || "Unknown"}
Website: ${p.website || "Unknown"}
Facebook: ${p.facebook || "Unknown"}
WhatsApp: ${p.whatsapp || "Unknown"}
Email: ${p.email || "Unknown"}
Buying intent: ${p.buyingIntent || "Unknown"}
`;
}

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

async function saveLeadToGoogleSheets({ sessionId, profileContext, summary, transcript }) {
  if (!GOOGLE_SCRIPT_URL) {
    console.log("Google Script URL missing.");
    return;
  }

  try {
    await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
  sessionId,

  clinic: clinicProfiles[sessionId]?.clinicName || "",
  city: clinicProfiles[sessionId]?.city || "",
  clinicType: clinicProfiles[sessionId]?.clinicType || "",
  website: clinicProfiles[sessionId]?.website || "",
  whatsapp: clinicProfiles[sessionId]?.whatsapp || "",
  email: clinicProfiles[sessionId]?.email || "",
  intent: clinicProfiles[sessionId]?.buyingIntent || "",

  summary,
  transcript,

  timestamp: new Date().toISOString()
      })
    });

    console.log("Lead saved to Google Sheets.");
  } catch (error) {
    console.error("Google Sheets save error:", error);
  }
}

function calculateRecoveryEstimate(transcript) {
  const text = (transcript || "").toLowerCase();

  const missedMatch = text.match(/(\d+)\s*(missed calls|missed call|calls)/i);
  const lateMatch = text.match(/(\d+)\s*(late replies|late reply|messages|inquiries|replies)/i);
  const valueMatch = text.match(/₱?\s?(\d{3,6})\s*(per booking|per patient|average|avg)/i);
  const conversionMatch = text.match(/(\d{1,3})\s*%/i);

  const missedCallsPerWeek = missedMatch ? Number(missedMatch[1]) : 0;
  const lateRepliesPerWeek = lateMatch ? Number(lateMatch[1]) : 0;

  const patientValue = valueMatch ? Number(valueMatch[1]) : 3500;
  const conversionRate = conversionMatch ? Number(conversionMatch[1]) / 100 : null;

  let recoveredBookingsPerMonth = 0;
  let explanation = "";

  if (missedCallsPerWeek && conversionRate) {
    recoveredBookingsPerMonth = missedCallsPerWeek * conversionRate * 4;
    explanation = `Based on ${missedCallsPerWeek} missed calls per week, ${Math.round(conversionRate * 100)}% stated conversion, and ₱${patientValue.toLocaleString()} average booking value.`;
  } else {
    recoveredBookingsPerMonth =
      missedCallsPerWeek * 4.3 * (1 / 3) +
      lateRepliesPerWeek * 4.3 * (1 / 5);

    explanation = `Based on a rough benchmark of recovering about 1 in 3 missed calls and 1 in 5 delayed replies, using ₱${patientValue.toLocaleString()} average booking value.`;
  }

  const estimate = Math.round((recoveredBookingsPerMonth * patientValue) / 5000) * 5000;

  return {
    revenue: `₱${estimate.toLocaleString()}/month`,
    expectedOutcome: `Estimated recoverable revenue is around ₱${estimate.toLocaleString()}/month. ${explanation}`
  };
}

async function generateAudit(profileContext, transcript, sessionId) {
    const websiteFindings = websiteFindingsBySession[sessionId];

    const websiteContext = websiteFindings && !websiteFindings.error
      ? `
Website homepage scan:
Reviewed URL: ${websiteFindings.reviewedUrl}
Phone visible: ${websiteFindings.phoneVisible ? "Yes" : "No / unclear"}
Booking CTA visible: ${websiteFindings.bookingCtaVisible ? "Yes" : "No / unclear"}
Messenger or WhatsApp visible: ${websiteFindings.messengerWhatsappVisible ? "Yes" : "No / unclear"}
Trust signals visible: ${websiteFindings.trustSignalsVisible ? "Yes" : "No / unclear"}
`
      : "";
  try {
    const prompt = `
You are Eden Clinic Network's senior clinic growth consultant.

Analyze this clinic conversation and return ONLY valid JSON.

Clinic Profile:
${profileContext}

Conversation:
${transcript}

${websiteContext}

Important:

Use information from the actual clinic conversation.

Do not use generic recommendations.

Fit Score should reflect how strongly Eden Clinic Network can help this clinic using missed-call recovery, fast follow-up, Messenger AI, booking support and revenue recovery systems.

Urgency should be HIGH, MEDIUM or LOW depending on the estimated revenue being lost.

Action Plan should be specific to the clinic's answers.

Return:

Return ONLY valid JSON:
{
  "clinicName": "SmileCare Dental Cebu",
  "score": 72,
  "revenue": "₱45,000 - ₱180,000/month",

  "biggestLeak":
  "Most important revenue leak discovered from the conversation",

  "leakExplanation":
  "Brief explanation of why this leak is costing bookings or revenue",

  "fitScore":
  92,

  "expectedOutcome":
  "Estimated bookings or revenue that could realistically be recovered",

  "urgency":
  "HIGH, MEDIUM or LOW",

  "actionPlan":
  "Specific 30-day action plan based on the clinic's situation",

  "opportunity1":
  "Most valuable improvement",

  "opportunity2":
  "Second most valuable improvement",

  "opportunity3":
"Third most valuable improvement",

"websiteFindings":
"Brief homepage findings if website scan is available",

"bookingFriction":
"Brief note on website booking friction",

"trustSignals":
"Brief note on trust signals",

"responseRisk":
"Brief note on risk from slow or unclear contact options"
}
`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + OPENAI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3
      })
    });

    const data = await response.json();

    const rawAudit = data.choices[0].message.content
  .replace(/```json/g, "")
  .replace(/```/g, "")
  .trim();

const audit = JSON.parse(rawAudit);

const recovery = calculateRecoveryEstimate(transcript);
audit.revenue = recovery.revenue;
audit.expectedOutcome = recovery.expectedOutcome;

return audit;

  } catch (error) {
    console.error("Audit generation error:", error);

    return {
  score: 50,
  revenue: "Unknown",
  biggestLeak: "Missed Calls",
  leakExplanation: "Patients may be trying to contact the clinic but not receiving a fast enough response.",
  fitScore: 70,
  expectedOutcome: "Potential recovery depends on call volume and inquiry handling.",
  urgency: "MEDIUM",
  actionPlan: "Track missed calls, improve reply speed, and add follow-up for unbooked inquiries.",
  opportunity1: "Missed Calls",
  opportunity2: "Slow Replies",
  opportunity3: "Weak Follow-Up"
};
  }
}
function safe(value, fallback = "") {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    value === "undefined" ||
    value === "null"
  ) {
    return fallback;
  }

  return String(value);
}

function buildAuditHtml({ clinic, audit }) {
  const clinicName = safe(audit.clinicName, clinic || "Your Clinic");
  const score = safe(audit.score, "65");
  const revenue = safe(audit.revenue, "₱45,000 - ₱180,000/month");
  const summary = safe(
    audit.summary,
    `${clinicName} appears to have recoverable revenue opportunities through missed calls, slow replies, and weak follow-up.`
  );

  const biggestLeak = safe(audit.biggestLeak, "Missed calls and slow replies");
  const leakExplanation = safe(
    audit.leakExplanation,
    "Patients who try to contact your clinic may not always receive a fast response, which can lead to lost bookings and missed revenue."
  );

  const expectedOutcome = safe(
    audit.expectedOutcome,
    "Potential recovery depends on call volume, inquiry volume, and how consistently the clinic follows up."
  );

  const fitScore = safe(audit.fitScore, "70");
  const urgency = safe(audit.urgency, "MEDIUM");

  const opportunity1 = safe(audit.opportunity1, "Recover missed calls faster");
  const opportunity2 = safe(audit.opportunity2, "Improve Messenger reply speed");
  const opportunity3 = safe(audit.opportunity3, "Follow up with unbooked patients");

  const websiteFindings = safe(audit.websiteFindings, "Website review not completed yet.");
  const facebookFindings = safe(audit.facebookFindings, "Facebook page review not completed yet.");
  const googleMapsFindings = safe(audit.googleMapsFindings, "Google Maps review not completed yet.");
  const reviewsScore = safe(audit.reviewsScore, "Unknown");
  const bookingFriction = safe(audit.bookingFriction, "Not enough information yet.");
  const trustSignals = safe(audit.trustSignals, "Not enough information yet.");
  const responseRisk = safe(audit.responseRisk, "Unknown");

  return `
<!DOCTYPE html>
<html>
<head>
  <title>${clinicName} - Eden Clinic Growth Audit</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>

<body style="
font-family: Arial, sans-serif;
max-width: 900px;
margin: auto;
padding: 40px 18px;
background: #f8fafc;
color: #111827;
line-height: 1.55;
">

<div style="
background: linear-gradient(135deg, #111827, #312e81);
color:white;
padding:32px;
border-radius:22px;
margin-bottom:22px;
">

  <div style="
  font-size:13px;
  letter-spacing:0.06em;
  text-transform:uppercase;
  color:#c7d2fe;
  font-weight:bold;
  margin-bottom:8px;
  ">
  Eden Clinic Network • AI Growth Audit
  </div>

  <h1 style="
  font-size:36px;
  line-height:1.1;
  margin:0 0 8px;
  ">
  ${clinicName}
  </h1>

  <p style="
  font-size:18px;
  color:#e5e7eb;
  margin:0;
  ">
  Clinic Revenue Rescue Audit™
  </p>

</div>

<div style="
display:grid;
grid-template-columns:1fr 1fr;
gap:16px;
margin-bottom:20px;
">

  <div style="
  background:#eef4ff;
  padding:22px;
  border-radius:18px;
  ">

    <h2 style="margin-top:0;">Growth Score</h2>

    <div style="
    font-size:52px;
    font-weight:bold;
    color:#2563eb;
    ">
    ${score}/100
    </div>

  </div>

  <div style="
  background:#ecfdf5;
  padding:22px;
  border-radius:18px;
  ">

    <h2 style="margin-top:0;">Estimated Recovery Opportunity</h2>

    <div style="
    font-size:30px;
    font-weight:bold;
    color:#16a34a;
    ">
    ${revenue}
    </div>

  </div>

</div>

<div style="
background:white;
padding:24px;
border-radius:18px;
margin-bottom:18px;
border:1px solid #e5e7eb;
">

  <h2 style="margin-top:0;">Audit Summary</h2>
  <p style="font-size:18px;color:#374151;">${summary}</p>

</div>

<div style="
background:#fff7ed;
padding:24px;
border-radius:18px;
margin-bottom:18px;
border-left:7px solid #f97316;
">

  <h2 style="margin-top:0;">Biggest Revenue Leak</h2>

  <div style="
  font-size:26px;
  font-weight:bold;
  color:#c2410c;
  margin-bottom:8px;
  ">
  ${biggestLeak}
  </div>

  <p>${leakExplanation}</p>

</div>

<div style="
background:white;
padding:24px;
border-radius:18px;
margin-bottom:18px;
border:1px solid #e5e7eb;
">

  <h2 style="margin-top:0;">Eden Compatibility</h2>

  <div style="
  font-size:42px;
  font-weight:bold;
  color:#7c3aed;
  ">
  ${fitScore}/100
  </div>

  <p>
  How suitable this clinic appears for Eden's missed-call recovery,
  fast follow-up, Messenger AI, and booking support system.
  </p>

</div>

<div style="
background:#fef2f2;
padding:24px;
border-radius:18px;
border-left:7px solid #dc2626;
margin-bottom:18px;
">

  <h2 style="margin-top:0;">Priority Level</h2>

  <div style="
  font-size:30px;
  font-weight:bold;
  color:#dc2626;
  ">
  ${urgency}
  </div>

  <p>
  The sooner this clinic addresses its biggest revenue leak,
  the faster bookings and revenue can be recovered.
  </p>

</div>

<div style="
background:white;
padding:24px;
border-radius:18px;
margin-bottom:18px;
border:1px solid #e5e7eb;
">

  <h2 style="margin-top:0;">Top 3 Opportunities</h2>

  <ol style="font-size:17px;">
    <li>${opportunity1}</li>
    <li>${opportunity2}</li>
    <li>${opportunity3}</li>
  </ol>

</div>

<div style="
background:#eff6ff;
padding:24px;
border-radius:18px;
margin-bottom:18px;
">

  <h2 style="margin-top:0;">Expected Outcome</h2>

  <p style="
  font-size:22px;
  font-weight:bold;
  color:#2563eb;
  ">
  ${expectedOutcome}
  </p>

</div>

<div style="
background:white;
padding:24px;
border-radius:18px;
margin-bottom:18px;
border:1px solid #e5e7eb;
">

  <h2 style="margin-top:0;">Premium Audit Signals</h2>

  <p><strong>Website findings:</strong> ${websiteFindings}</p>
  <p><strong>Facebook findings:</strong> ${facebookFindings}</p>
  <p><strong>Google Maps findings:</strong> ${googleMapsFindings}</p>
  <p><strong>Reviews score:</strong> ${reviewsScore}</p>
  <p><strong>Booking friction:</strong> ${bookingFriction}</p>
  <p><strong>Trust signals:</strong> ${trustSignals}</p>
  <p><strong>Response risk:</strong> ${responseRisk}</p>

</div>

<div style="
background:white;
padding:24px;
border-radius:18px;
margin-bottom:18px;
border:1px solid #e5e7eb;
">

  <h2 style="margin-top:0;">30-Day Revenue Rescue Plan</h2>

  <p><strong>Week 1:</strong> Track missed calls and slow replies.</p>
  <p><strong>Week 2:</strong> Add fast follow-up for missed inquiries.</p>
  <p><strong>Week 3:</strong> Improve Messenger and booking response flow.</p>
  <p><strong>Week 4:</strong> Review recovered bookings and revenue impact.</p>

</div>

<div style="
background:#111827;
color:white;
padding:28px;
border-radius:22px;
margin-top:28px;
">

  <h2 style="color:white;margin-top:0;">Want Eden to help recover these bookings?</h2>

  <p style="color:#e5e7eb;font-size:17px;">
  We can review your clinic setup and show which missed calls, slow replies,
  or booking leaks can be recovered first.
  </p>

  <p style="
  font-size:22px;
  font-weight:bold;
  ">
  Request your free implementation review:
  </p>

  <p style="font-size:20px;font-weight:bold;">
  clinicnet.live
  </p>

</div>

</body>
</html>
`;
}

async function createLeadSummary(session, sessionId) {
  try {
    const transcript = formatTranscript(session);
    const profileContext = getProfileContext(sessionId);

    const audit = await generateAudit(profileContext, transcript);

console.log("Audit:", audit);

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

Use the known clinic information and transcript.

Return:
Clinic:
City:
Clinic type:
Contact details:
Main problems:
Estimated opportunity:
Buying intent score 1-10:
Lead temperature: HOT/WARM/COLD
Recommended follow-up:

If unknown, write Unknown.
`
          },
          {
            role: "user",
            content: profileContext + "\n\nTranscript:\n" + transcript
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

function createTelegramLeadCard(sessionId, summary) {
  const p = clinicProfiles[sessionId] || {};

  const tempMatch = summary.match(/Lead temperature:\s*([^\n]+)/i);
  const intentMatch = summary.match(/Buying intent score 1-10:\s*([^\n]+)/i);
  const opportunityMatch = summary.match(/Estimated opportunity:\s*([\s\S]*?)(Buying intent|Lead temperature|Recommended follow-up|$)/i);
  const problemMatch = summary.match(/Main problems:\s*([\s\S]*?)(Estimated opportunity|Buying intent|Lead temperature|Recommended follow-up|$)/i);
  const followMatch = summary.match(/Recommended follow-up:\s*([\s\S]*)/i);

  const temperature = tempMatch ? tempMatch[1].trim() : "Unknown";
  const intent = intentMatch ? intentMatch[1].trim() : "Unknown";
  const opportunity = opportunityMatch ? opportunityMatch[1].trim() : "Unknown";
  const problem = problemMatch ? problemMatch[1].trim() : "Unknown";
  const followUp = followMatch ? followMatch[1].trim() : "Review lead and follow up.";

  return `
${alertedSessions[sessionId] ? "🔁 UPDATED CLINIC AUDIT LEAD" : "🔥 NEW CLINIC AUDIT LEAD"}

🏥 ${p.clinicName || "Unknown clinic"}
📍 ${p.city || "Unknown city"}
🏷️ ${p.clinicType || "Unknown type"}
🌡️ ${temperature} (${intent})

🌐 ${p.website || "No website captured"}
📧 ${p.email || "No email captured"}
📘 ${p.facebook || "No Facebook captured"}
📱 ${p.whatsapp || "No WhatsApp captured"}

💰 Estimated opportunity:
${opportunity}

⚠ Biggest leak:
${problem}

➡ Recommended next step:
${followUp}

Session:
${sessionId}
`;
}
  
async function maybeSendLeadAlert(sessionId, latestUserText) {
  const profile = clinicProfiles[sessionId] || {};

  if (!hasLeadSignal(latestUserText)) return;

  const session = sessions[sessionId] || [];
  const summary = await createLeadSummary(session, sessionId);
  
  updateProfileFromText(sessionId, summary);

  const updatedProfile = clinicProfiles[sessionId] || {};

const alertSnapshot = [
  updatedProfile.clinicName,
  updatedProfile.city,
  updatedProfile.clinicType,
  updatedProfile.website,
  updatedProfile.facebook,
  updatedProfile.whatsapp,
  updatedProfile.email,
  updatedProfile.buyingIntent,
  updatedProfile.mainPainPoint
].join("|");

const hasImportantUpdate =
  updatedProfile.email ||
  updatedProfile.whatsapp ||
  updatedProfile.website ||
  updatedProfile.facebook ||
  updatedProfile.buyingIntent === "high";

if (leadAlertSnapshots[sessionId] === alertSnapshot) return;

if (alertedSessions[sessionId] && !hasImportantUpdate) return;
  const transcript = formatTranscript(session);
  const profileContext = getProfileContext(sessionId);
const audit = await generateAudit(profileContext, transcript);
auditPreviewHtmlBySession[sessionId] = buildAuditHtml({
  clinic: profile.clinicName || "Your Clinic",
  audit
});
const message = createTelegramLeadCard(sessionId, summary);
  
  await saveLeadToGoogleSheets({
  sessionId,
  profileContext,
  summary,
  transcript
});
  
  await sendTelegram(message);
  if (hasImportantUpdate) {
  contactUpdatedSessions[sessionId] = true;
}

leadAlertSnapshots[sessionId] = alertSnapshot;
alertedSessions[sessionId] = true;
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

    ensureProfile(sessionId);
    updateProfileFromText(sessionId, userText);

const currentProfile = clinicProfiles[sessionId];

if (
  currentProfile?.website &&
  !websiteFindingsBySession[sessionId]
) {
  websiteFindingsBySession[sessionId] =
    await analyzeClinicWebsite(currentProfile.website);
}
    
    sessions[sessionId].push({
      role: "user",
      content: userText
    });
   
    if (sessions[sessionId].length % 6 === 0) {
  await extractProfileWithAI(sessionId);
    }

    sessions[sessionId] = sessions[sessionId].slice(-50);

    const profileContext = getProfileContext(sessionId);

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
            content: SYSTEM_PROMPT + "\n\n" + profileContext
          },
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

    try {
  await maybeSendLeadAlert(sessionId, userText);
} catch (leadError) {
  console.error("Lead alert failed:", leadError);
}

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

async function extractProfileWithAI(sessionId) {
  try {
    const history = sessions[sessionId] || [];
    const recentMessages = history.slice(-12);

    if (recentMessages.length < 4) return;

    const profile = clinicProfiles[sessionId] || {};

    const extractionPrompt = `
Extract clinic lead information from this chat.

Return ONLY valid JSON.
No markdown.
No explanation.

Fields:
{
  "clinicName": "",
  "personName": "",
  "city": "",
  "clinicType": "",
  "website": "",
  "facebook": "",
  "whatsapp": "",
  "email": "",
  "buyingIntent": "",
  "mainPainPoint": ""
}

Rules:
- Use empty string if unknown.
- Do not guess.
- buyingIntent can be: low, medium, high, or empty.
- mainPainPoint should be short.
`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          { role: "system", content: extractionPrompt },
          { role: "user", content: JSON.stringify(recentMessages) }
        ]
      })
    });

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || "{}";

    const extracted = JSON.parse(raw);

    clinicProfiles[sessionId] = {
      ...profile,
      ...Object.fromEntries(
        Object.entries(extracted).filter(([key, value]) => value && value.trim() !== "")
      )
    };

    console.log("AI profile extracted:", sessionId, clinicProfiles[sessionId]);

  } catch (error) {
    console.error("AI profile extraction error:", error.message);
  }
}

app.post("/chat", async (req, res) => {
  try {
    const userText = req.body.message || "";
    const sessionId = req.body.sessionId || "website-default";

    if (!userText.trim()) {
      return res.json({ reply: "Hi 😊 What is your clinic name and website?" });
    }

    const reply = await getAIReply(userText, sessionId);
    res.json({
  reply,
  sessionId,
  auditPreviewUrl: `https://eden-audit-chat.onrender.com/audit-preview/${sessionId}`
});
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ reply: "One sec 😊 let me check that for you." });
  }
});

app.get("/audit-preview/:sessionId", async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    if (auditPreviewHtmlBySession[sessionId]) {
  return res.send(auditPreviewHtmlBySession[sessionId]);
    }
    if (!sessions[sessionId] || sessions[sessionId].length === 0) {
  return res.send(buildAuditHtml({
    clinic: "Audit not ready yet",
    audit: {
      clinicName: "Audit not ready yet",
      score: 0,
      revenue: "Waiting for clinic conversation",
      summary: "Please complete the clinic audit chat first. Eden needs the actual clinic conversation before generating a useful preview.",
      biggestLeak: "Not enough information yet",
      leakExplanation: "No clinic conversation was found for this audit preview link.",
      fitScore: 0,
      expectedOutcome: "Waiting for clinic conversation",
      urgency: "LOW",
      opportunity1: "Complete the audit chat",
      opportunity2: "Share clinic name and city",
      opportunity3: "Share how bookings and inquiries are handled"
    }
  }));
}
    const session = sessions[sessionId] || [];
    const transcript = formatTranscript(session);
    const profileContext = getProfileContext(sessionId);
    const profile = clinicProfiles[sessionId] || {};    
    const audit = await generateAudit(profileContext, transcript);

    const html = buildAuditHtml({
      clinic:
  profile.clinicName ||
  sessions[sessionId]?.find(m => m.role === "user")?.content?.match(/my clinic is ([^.\n]+)/i)?.[1] ||
  "Your Clinic",
      audit
    });

    res.send(html);
  } catch (error) {
    console.error("Audit preview error:", error);
    res.status(500).send("Audit preview unavailable.");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
