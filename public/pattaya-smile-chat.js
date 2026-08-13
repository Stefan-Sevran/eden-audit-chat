<script>
(function () {
const CHAT_API_URL =
"https://eden-audit-chat.onrender.com/booking-chat";

const LIVE_CHAT_API_URL =
"https://eden-audit-chat.onrender.com/live-chat";

const root = document.getElementById(
"pattaya-smile-reception-chat"
);

if (!root) return;

const messages = root.querySelector(
"#pattaya-smile-chat-messages"
);

const input = root.querySelector(
"#pattaya-smile-chat-input"
);

const sendBtn = root.querySelector(
"#pattaya-smile-chat-send"
);

const voiceBtn = root.querySelector(
"#pattaya-smile-voice-button"
);

const status = root.querySelector(
"#pattaya-smile-chat-status"
);

let sessionId = localStorage.getItem(
"pattayaSmileBookingSessionIdV1"
);

let liveChatToken = localStorage.getItem(
"pattayaSmileLiveChatTokenV1"
);

let lastLiveMessageAt = localStorage.getItem(
"pattayaSmileLastLiveMessageAtV1"
) || "1970-01-01T00:00:00.000Z";

let humanMode =
localStorage.getItem(
"pattayaSmileHumanModeV1"
) === "true";

let livePollInFlight = false;
const seenLiveMessageIds = {};

if (!sessionId) {
sessionId =
"booking_pattaya_smile_" +
Math.random().toString(36).substring(2) +
Date.now();

localStorage.setItem(
"pattayaSmileBookingSessionIdV1",
sessionId
);
}

function fitInput() {
input.style.height = "auto";
input.style.height =
Math.min(input.scrollHeight, 110) + "px";
}

function scrollMessagesToBottom() {
messages.scrollTop = messages.scrollHeight;
}

function setHumanMode(isHuman) {
humanMode = Boolean(isHuman);

localStorage.setItem(
"pattayaSmileHumanModeV1",
humanMode ? "true" : "false"
);

if (humanMode) {
status.innerHTML =
"<span></span> Clinic Team is here · ทีมคลินิกกำลังช่วยคุณ";

input.placeholder = "Message the Clinic Team...";
} else {
status.innerHTML =
"<span></span> AI + Human Team · Usually replies within 60 sec";

input.placeholder = "Message Nida...";
}
}

function addMessage(text, sender, loading, teamMessage) {
const div = document.createElement("div");

div.className =
"pattaya-smile-chat-msg " +
(
sender === "user"
? "pattaya-smile-chat-user"
: "pattaya-smile-chat-bot"
);

if (teamMessage) {
div.classList.add("pattaya-smile-chat-team");
}

if (loading) {
div.classList.add("pattaya-smile-chat-loading");

div.textContent = teamMessage
? "Clinic Team is typing..."
: "Nida is typing... กำลังพิมพ์ค่ะ";
} else {
div.textContent = text;
}

messages.appendChild(div);
scrollMessagesToBottom();

return div;
}

function addSystemMessage(text) {
const div = document.createElement("div");

div.className = "pattaya-smile-chat-system";
div.textContent = text;

messages.appendChild(div);
scrollMessagesToBottom();

return div;
}

function saveLiveToken(token) {
if (!token) return;

liveChatToken = token;

localStorage.setItem(
"pattayaSmileLiveChatTokenV1",
token
);
}

function saveLastLiveMessageAt(value) {
if (!value) return;

lastLiveMessageAt = value;

localStorage.setItem(
"pattayaSmileLastLiveMessageAtV1",
value
);
}

function handleLiveMessages(data) {
if (!data) return;

setHumanMode(data.mode === "human");

const liveMessages = Array.isArray(data.messages)
? data.messages
: [];

liveMessages.forEach(function (message) {
if (message.created_at) {
saveLastLiveMessageAt(message.created_at);
}

if (
message.id &&
seenLiveMessageIds[message.id]
) {
return;
}

if (message.id) {
seenLiveMessageIds[message.id] = true;
}

if (message.sender === "human") {
const staffName =
message.staff_name ||
"Clinic Team";

addMessage(
staffName + "\n" + message.body,
"bot",
false,
true
);
}

if (message.sender === "system") {
addSystemMessage(message.body);
}
});
}

async function pollLiveChat() {
if (
!liveChatToken ||
!sessionId ||
livePollInFlight
) {
return;
}

livePollInFlight = true;

try {
const response = await fetch(
LIVE_CHAT_API_URL +
"/" +
encodeURIComponent(sessionId) +
"?token=" +
encodeURIComponent(liveChatToken) +
"&after=" +
encodeURIComponent(lastLiveMessageAt),
{
method: "GET",
cache: "no-store"
}
);

if (!response.ok) return;

const data = await response.json();

handleLiveMessages(data);
} catch (error) {
/* Quietly retry on the next poll. */
} finally {
livePollInFlight = false;
}
}

async function sendMessage(customText) {
const text = (
customText || input.value || ""
).trim();

if (!text || sendBtn.disabled) return;

addMessage(text, "user", false);

input.value = "";
fitInput();
sendBtn.disabled = true;

const loadingMsg = addMessage(
"",
"bot",
true,
humanMode
);

try {
const response = await fetch(CHAT_API_URL, {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
message: text,
sessionId: sessionId,
clinicId: "pattaya-smile"
})
});

if (!response.ok) {
throw new Error("Request failed");
}

const data = await response.json();

loadingMsg.remove();

saveLiveToken(data.liveChatToken);

if (data.humanMode) {
setHumanMode(true);
pollLiveChat();
} else {
setHumanMode(false);

addMessage(
data.reply ||
"Of course 😊 ได้เลยค่ะ How can I help you today?",
"bot",
false
);
}
} catch (error) {
loadingMsg.remove();

addMessage(
"Small connection issue right now 🙏 กรุณาลองใหม่อีกครั้งในสักครู่นะคะ",
"bot",
false
);
}

sendBtn.disabled = false;
input.focus();
}

sendBtn.addEventListener("click", function (event) {
event.preventDefault();
event.stopPropagation();
sendMessage();
});

input.addEventListener("input", fitInput);

input.addEventListener("keydown", function (event) {
if (event.key === "Enter" && !event.shiftKey) {
event.preventDefault();
sendMessage();
}
});

let voicePeerConnection = null;
let voiceAudioElement = null;
let voiceActive = false;

async function startVoiceCall() {
if (voiceActive) {
return;
}

try {
voiceBtn.disabled = true;
voiceBtn.textContent = "Connecting...";

const pc = new RTCPeerConnection();

voicePeerConnection = pc;

const dataChannel =
pc.createDataChannel("oai-events");

dataChannel.addEventListener(
"message",
async function (event) {
try {
const realtimeEvent =
JSON.parse(event.data);

console.log(
"Realtime event:",
realtimeEvent
);

if (
realtimeEvent.type ===
"response.function_call_arguments.done" &&
realtimeEvent.name ===
"create_patient_booking"
) {
const bookingArgs =
JSON.parse(realtimeEvent.arguments || "{}");

try {
const bookingResponse = await fetch(
"https://eden-audit-chat.onrender.com/voice-booking",
{
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
sessionId: sessionId,
clinicId: "pattaya-smile",
...bookingArgs
})
}
);

const bookingResult =
await bookingResponse.json();

console.log(
"VOICE BOOKING SAVE RESULT:",
bookingResult
);

dataChannel.send(
JSON.stringify({
type: "conversation.item.create",
item: {
type: "function_call_output",
call_id: realtimeEvent.call_id,
output: JSON.stringify(bookingResult)
}
})
);

dataChannel.send(
JSON.stringify({
type: "response.create",
response: {
instructions:
bookingResult.success
? "Tell the patient briefly that their appointment request has been sent to the clinic team for confirmation. Do not say the appointment is confirmed."
: "Tell the patient briefly that the booking request could not be saved and ask them to continue by chat or try again."
}
})
);
} catch (error) {
console.error(
"Voice booking save error:",
error
);
}
}

} catch (error) {
console.error(
"Realtime event parse error:",
error
);
}
}
);

const audio = document.createElement("audio");
audio.autoplay = true;
audio.style.display = "none";

document.body.appendChild(audio);

voiceAudioElement = audio;

pc.ontrack = function (event) {
audio.srcObject = event.streams[0];
};

const localStream =
await navigator.mediaDevices.getUserMedia({
audio: true
});

localStream.getTracks().forEach(function (track) {
pc.addTrack(track, localStream);
});

const offer = await pc.createOffer();

await pc.setLocalDescription(offer);

const response = await fetch(
"https://eden-audit-chat.onrender.com/realtime-call",
{
method: "POST",
headers: {
"Content-Type": "application/sdp"
},
body: offer.sdp
}
);

if (!response.ok) {
throw new Error(
"Voice connection request failed"
);
}

const answerSdp = await response.text();

await pc.setRemoteDescription({
type: "answer",
sdp: answerSdp
});

voiceActive = true;

voiceBtn.disabled = false;
voiceBtn.textContent = "🔴 End Voice";
} catch (error) {
console.error("Voice call error:", error);

voiceBtn.disabled = false;
voiceBtn.textContent = "🎙️ Talk to Nida";

addSystemMessage(
"Voice is unavailable right now. Please continue by chat."
);
}
}

function stopVoiceCall() {
if (voicePeerConnection) {
voicePeerConnection
.getSenders()
.forEach(function (sender) {
if (sender.track) {
sender.track.stop();
}
});

voicePeerConnection.close();
voicePeerConnection = null;
}

if (voiceAudioElement) {
voiceAudioElement.remove();
voiceAudioElement = null;
}

voiceActive = false;
voiceBtn.disabled = false;
voiceBtn.textContent = "🎙️ Talk to Nida";
}

voiceBtn.addEventListener("click", function () {
if (voiceActive) {
stopVoiceCall();
} else {
startVoiceCall();
}
});

setHumanMode(humanMode);
fitInput();
pollLiveChat();

window.setInterval(function () {
  pollLiveChat();
}, 2500);

})();
