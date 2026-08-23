const crypto = require("crypto");

const {
  createSupabaseClient
} = require("./supabase");

function createLiveInboxIntegration({
  supabaseUrl,
  supabaseServiceRoleKey,
  ensurePatientBooking
}) {
  const {
    supabaseConfigured,
    supabaseRequest:
      sharedSupabaseRequest
  } = createSupabaseClient({
    supabaseUrl,
    supabaseServiceRoleKey
  });

  function liveInboxConfigured() {
    return supabaseConfigured();
  }

  async function supabaseRequest(
    path,
    options = {}
  ) {
    if (!liveInboxConfigured()) {
      throw new Error(
        "Supabase live inbox is not configured on Render."
      );
    }

    return sharedSupabaseRequest(
      path,
      options
    );
  }

  function createVisitorToken() {
    return crypto
      .randomBytes(24)
      .toString("hex");
  }

  function getBookingContactSnapshot(
    sessionId,
    clinicId
  ) {
    const booking =
      ensurePatientBooking(
        sessionId,
        clinicId
      );

    return {
      patient_name:
        booking.patientName || null,
      phone:
        booking.phone || null,
      whatsapp:
        booking.whatsapp || null,
      email:
        booking.email || null
    };
  }

  async function upsertLiveConversation(
    sessionId,
    clinicId,
    latestMessage
  ) {
    if (!liveInboxConfigured()) {
      return null;
    }

    const contact =
      getBookingContactSnapshot(
        sessionId,
        clinicId
      );

    const now =
      new Date().toISOString();

    const record = {
      clinic_id: clinicId,
      session_id: sessionId,
      ...contact,
      last_message_preview:
        String(
          latestMessage || ""
        ).slice(0, 500),
      last_message_at: now,
      updated_at: now
    };

    const rows =
      await supabaseRequest(
        "/rest/v1/live_conversations?on_conflict=session_id",
        {
          method: "POST",
          headers: {
            Prefer:
              "resolution=merge-duplicates,return=representation"
          },
          body:
            JSON.stringify(record)
        }
      );

    return rows && rows[0]
      ? rows[0]
      : null;
  }

  async function getLiveConversationBySession(
    sessionId
  ) {
    if (!liveInboxConfigured()) {
      return null;
    }

    const rows =
      await supabaseRequest(
        "/rest/v1/live_conversations?session_id=eq." +
          encodeURIComponent(
            sessionId
          ) +
          "&select=*"
      );

    return rows && rows[0]
      ? rows[0]
      : null;
  }

  async function recordLiveMessage(
    sessionId,
    clinicId,
    sender,
    body,
    staffName
  ) {
    if (
      !liveInboxConfigured() ||
      !body ||
      !String(body).trim()
    ) {
      return null;
    }

    let conversation =
      await upsertLiveConversation(
        sessionId,
        clinicId,
        body
      );

    if (!conversation) {
      return null;
    }

    if (
      !conversation.visitor_token
    ) {
      const visitorToken =
        createVisitorToken();

      const rows =
        await supabaseRequest(
          "/rest/v1/live_conversations?id=eq." +
            conversation.id,
          {
            method: "PATCH",
            headers: {
              Prefer:
                "return=representation"
            },
            body:
              JSON.stringify({
                visitor_token:
                  visitorToken
              })
          }
        );

      conversation =
        rows && rows[0]
          ? rows[0]
          : conversation;
    }

    await supabaseRequest(
      "/rest/v1/live_messages",
      {
        method: "POST",
        headers: {
          Prefer:
            "return=minimal"
        },
        body:
          JSON.stringify({
            conversation_id:
              conversation.id,
            sender,
            body:
              String(body).trim(),
            staff_name:
              staffName || null
          })
      }
    );

    return conversation;
  }

  async function updateLiveConversation(
    id,
    changes
  ) {
    const rows =
      await supabaseRequest(
        "/rest/v1/live_conversations?id=eq." +
          encodeURIComponent(id),
        {
          method: "PATCH",
          headers: {
            Prefer:
              "return=representation"
          },
          body:
            JSON.stringify({
              ...changes,
              updated_at:
                new Date()
                  .toISOString()
            })
        }
      );

    return rows && rows[0]
      ? rows[0]
      : null;
  }

  return {
    liveInboxConfigured,
    supabaseRequest,
    createVisitorToken,
    getBookingContactSnapshot,
    upsertLiveConversation,
    getLiveConversationBySession,
    recordLiveMessage,
    updateLiveConversation
  };
}

module.exports = {
  createLiveInboxIntegration
};
