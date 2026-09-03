const assert = require("assert");
const express = require("express");

const {
  createAuditIntake,
  yesLike,
  claimsPrematureCompletion,
  questionLike,
  realtimeTool,
  realtimeInstructions
} = require("../audits/intake-v232");

async function startServer(app) {
  const server = await new Promise((resolve) => {
    const listener = app.listen(
      0,
      "127.0.0.1",
      () => resolve(listener)
    );
  });

  const address = server.address();

  return {
    server,
    baseUrl:
      `http://127.0.0.1:${address.port}`
  };
}

async function jsonRequest(
  baseUrl,
  path,
  payload
) {
  const response = await fetch(
    baseUrl + path,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  return {
    status: response.status,
    body: await response.json()
  };
}

async function main() {
  assert(yesLike("ใช่"));
  assert(yesLike("Opo"));
  assert(yesLike("sakto"));
  assert(!yesLike("maybe"));
  assert(claimsPrematureCompletion("I'll prepare the audit now."));
  assert(questionLike("What does inquiry-to-booking rate mean?"));

  const guardedIntake = createAuditIntake({
    async modelTurn() {
      return {
        reply: "I'll prepare your Audit now.",
        updates: { clinicType: "Dental clinic" },
        answeredFields: [],
        ownerConfirmed: false
      };
    }
  });
  const guarded = await guardedIntake.handleText({
    sessionId: "guarded_audit_session_123456",
    message: "I run a dental clinic."
  });
  assert.doesNotMatch(guarded.reply, /prepare your Audit/i);
  assert.match(guarded.reply, /clinic.*name/i);

  let completed = 0;
  let lastCompletion = null;

  const intake = createAuditIntake({
    async onConfirmed(value) {
      completed += 1;
      lastCompletion = value;
      return { ok: true };
    },

    async modelTurn({ history }) {
      const user =
        history[history.length - 1].content;

      return {
        reply:
          "Got it. What is the clinic name?",
        updates: /dental/i.test(user)
          ? { clinicType: "Dental clinic" }
          : {},
        answeredFields: [],
        ownerConfirmed: false
      };
    }
  });

  const app = express();
  app.use(express.json());
  intake.install(app, express);

  const { server, baseUrl } =
    await startServer(app);

  try {
    const sessionId =
      "clinic_audit_test_123456789";

    const first = await jsonRequest(
      baseUrl,
      "/audit-chat",
      {
        sessionId,
        message:
          "I run a dental clinic."
      }
    );

    assert.equal(first.status, 200);
    assert.match(
      first.body.reply,
      /clinic name/i
    );
    assert.equal(
      intake.getSnapshot(sessionId)
        .fields.clinicType,
      "Dental clinic"
    );

    const full = {
      sessionId,
      clinicType: "Dental clinic",
      clinicName:
        "Digital Dental Pattaya",
      clinicLocation:
        "Pattaya, Thailand",
      websiteUrl:
        "digitaldentalpattaya.com",
      currency: "THB",
      monthlyWebFormInquiries: "20-30",
      monthlyMessengerTextInquiries: "80",
      monthlyMissedDelayedInquiries: "12",
      monthlyMissedCalls: "8",
      leadToBookingRate: "30%",
      attendanceRate: "90%",
      averageNewPatientValue: "5000",
      answeredFields: [
        "monthlyWebFormInquiries",
        "monthlyMessengerTextInquiries",
        "monthlyMissedDelayedInquiries",
        "monthlyMissedCalls",
        "leadToBookingRate",
        "attendanceRate",
        "averageNewPatientValue"
      ]
    };

    const adaptiveIntake = createAuditIntake({
      async modelTurn({ history }) {
        const latest = history.at(-1).content;
        if (/what.+inquiry-to-booking/i.test(latest)) {
          return {
            reply: "It means the share of inquiries that become booked appointments. For example, 65 bookings from 100 inquiries is 65%. What estimate fits your clinic?",
            updates: {},
            clearFields: [],
            answeredFields: [],
            ownerConfirmed: false
          };
        }
        if (/please adjust/i.test(latest)) {
          return {
            reply: "Of course. What should the revised inquiry-to-booking rate be?",
            updates: {},
            clearFields: ["leadToBookingRate"],
            answeredFields: [],
            ownerConfirmed: false
          };
        }
        if (/65%/.test(latest)) {
          return {
            reply: "Updated to 65%.",
            updates: { leadToBookingRate: "65%" },
            clearFields: [],
            answeredFields: ["leadToBookingRate"],
            ownerConfirmed: false
          };
        }
        return {
          reply: "Understood.",
          updates: {},
          clearFields: [],
          answeredFields: [],
          ownerConfirmed: false
        };
      }
    });
    const adaptiveId = "adaptive_audit_session_123456";
    await adaptiveIntake.handleVoice({
      sessionId: adaptiveId,
      payload: full
    });
    const firstSummary = await adaptiveIntake.handleText({
      sessionId: adaptiveId,
      message: "Continue"
    });
    assert.match(firstSummary.reply, /please confirm/i);
    const explanation = await adaptiveIntake.handleText({
      sessionId: adaptiveId,
      message: "What is inquiry-to-booking rate?"
    });
    assert.match(explanation.reply, /share of inquiries/i);
    assert.doesNotMatch(explanation.reply, /please confirm/i);
    const revisionRequest = await adaptiveIntake.handleText({
      sessionId: adaptiveId,
      message: "Please adjust that rate"
    });
    assert.match(revisionRequest.reply, /revised inquiry-to-booking rate/i);
    assert.equal(revisionRequest.snapshot.readyForConfirmation, false);
    const revisedSummary = await adaptiveIntake.handleText({
      sessionId: adaptiveId,
      message: "Set it to 65%"
    });
    assert.match(revisedSummary.reply, /Inquiry-to-booking rate: 65%/);
    const plainConfirmation = await adaptiveIntake.handleText({
      sessionId: adaptiveId,
      message: "ok"
    });
    assert.equal(plainConfirmation.snapshot.ownerConfirmed, true);
    assert.match(plainConfirmation.reply, /email or WhatsApp/i);

    const ready = await jsonRequest(
      baseUrl,
      "/audit-voice-intake",
      full
    );

    assert.equal(ready.status, 200);
    assert.equal(
      ready.body.snapshot
        .readyForConfirmation,
      true
    );
    assert.equal(
      ready.body.snapshot.interview
        .revenueInputs.leadToBookingRate,
      0.3
    );
    assert.match(
      ready.body.summary,
      /Digital Dental Pattaya/
    );

    const falseConfirmation =
      await jsonRequest(
        baseUrl,
        "/audit-voice-intake",
        {
          sessionId,
          ownerConfirmed: true,
          confirmationEvidence: "maybe"
        }
      );

    assert.equal(
      falseConfirmation.body.snapshot
        .ownerConfirmed,
      false
    );

    const complete = await jsonRequest(
      baseUrl,
      "/audit-voice-intake",
      {
        sessionId,
        ownerConfirmed: true,
        confirmationEvidence:
          "Yes, that's right",
        email: "owner@example.com"
      }
    );

    assert.equal(
      complete.body.snapshot.ownerConfirmed,
      true
    );
    assert.equal(
      complete.body.snapshot.status,
      "intake-complete"
    );
    assert.match(
      complete.body.snapshot.auditReference,
      /^AUD-\d{8}-[A-Z0-9]+$/
    );
    assert.equal(completed, 1);
    assert.equal(
      lastCompletion.snapshot.interview
        .revenueInputs.currency,
      "THB"
    );

    await jsonRequest(
      baseUrl,
      "/audit-voice-intake",
      {
        sessionId,
        email: "owner@example.com"
      }
    );

    assert.equal(
      completed,
      1,
      "Completion notification must be idempotent."
    );

    const rejectedDelivery = createAuditIntake({
      async onConfirmed() {
        return { ok: false };
      }
    });
    const rejectedSession =
      "clinic_audit_rejected_123456";
    await rejectedDelivery.handleVoice({
      sessionId: rejectedSession,
      payload: {
        ...full,
        sessionId: undefined,
        email: "owner@example.com"
      }
    });
    await assert.rejects(
      rejectedDelivery.handleVoice({
        sessionId: rejectedSession,
        payload: {
          ownerConfirmed: true,
          confirmationEvidence: "Opo"
        }
      }),
      /could not be delivered/
    );
    assert.notEqual(
      rejectedDelivery.getSnapshot(rejectedSession).status,
      "intake-complete"
    );

    const conflictId =
      "clinic_audit_conflict_123456";

    const conflicted = await jsonRequest(
      baseUrl,
      "/audit-voice-intake",
      {
        ...full,
        sessionId: conflictId,
        monthlyMessengerTextInquiries:
          "5",
        monthlyMissedDelayedInquiries:
          "12"
      }
    );

    assert.equal(
      conflicted.body.snapshot
        .readyForConfirmation,
      false
    );
    assert(
      conflicted.body.snapshot
        .validationErrors
        .some((value) =>
          /cannot exceed/.test(value)
        )
    );

    const invalid = await jsonRequest(
      baseUrl,
      "/audit-chat",
      {
        sessionId: "bad",
        message: "hello"
      }
    );

    assert.equal(invalid.status, 400);

    const tool = realtimeTool();
    assert.equal(
      tool.name,
      "save_clinic_audit_progress"
    );
    assert(
      tool.parameters.properties
        .confirmationEvidence
    );
    assert.match(
      realtimeInstructions(
        ready.body.snapshot
      ),
      /Never invent clinic facts/
    );
  } finally {
    await new Promise((resolve) =>
      server.close(resolve)
    );
  }

  let realtimeRequest = null;

  const realtimeIntake = createAuditIntake({
    openaiApiKey: "test-key",
    async fetchImpl(url, options) {
      realtimeRequest = { url, options };
      return {
        ok: true,
        status: 201,
        async text() {
          return "v=0\r\na=answer";
        }
      };
    }
  });

  const realtimeApp = express();
  realtimeApp.use(express.json());
  realtimeIntake.install(
    realtimeApp,
    express
  );

  const realtimeServer =
    await startServer(realtimeApp);

  try {
    const response = await fetch(
      realtimeServer.baseUrl +
        "/audit-realtime-call" +
        "?sessionId=" +
        "clinic_audit_realtime_123456",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/sdp"
        },
        body: "v=0\r\na=offer"
      }
    );

    assert.equal(response.status, 201);
    assert.match(
      await response.text(),
      /a=answer/
    );
    assert.equal(
      realtimeRequest.url,
      "https://api.openai.com/v1/realtime/calls"
    );
    assert.match(
      String(
        realtimeRequest.options.headers
          .Authorization
      ),
      /test-key/
    );
    const realtimeSession = JSON.parse(
      realtimeRequest.options.body.get("session")
    );
    assert.deepEqual(
      realtimeSession.audio.input.turn_detection,
      {
        type: "semantic_vad",
        eagerness: "medium",
        create_response: true,
        interrupt_response: true
      }
    );
  } finally {
    await new Promise((resolve) =>
      realtimeServer.server.close(resolve)
    );
  }

  console.log(
    "V2.3.2b production text/voice intake, adaptive clarification, confirmation and handoff tests passed."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
