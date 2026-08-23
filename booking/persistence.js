function createBookingPersistence({
  supabaseRequest,
  now = () => new Date().toISOString()
}) {
  if (typeof supabaseRequest !== "function") {
    throw new Error(
      "Booking persistence requires supabaseRequest"
    );
  }

  async function loadBookingSession(
    sessionId
  ) {
    const resolvedSessionId =
      String(sessionId || "").trim();

    if (!resolvedSessionId) {
      return null;
    }

    const rows =
      await supabaseRequest(
        "/rest/v1/booking_sessions" +
          "?session_id=eq." +
          encodeURIComponent(
            resolvedSessionId
          ) +
          "&select=" +
          [
            "session_id",
            "clinic_id",
            "booking_record_id",
            "booking_data",
            "updated_at"
          ].join(",") +
          "&limit=1"
      );

    const row =
      Array.isArray(rows)
        ? rows[0]
        : null;

    if (
      !row ||
      !row.booking_data ||
      typeof row.booking_data !== "object" ||
      Array.isArray(row.booking_data)
    ) {
      return null;
    }

    const booking = {
      ...row.booking_data
    };

    const clinicId =
      String(
        row.clinic_id ||
        booking.clinicId ||
        ""
      ).trim();

    if (
      !booking.bookingRecordId &&
      row.booking_record_id
    ) {
      booking.bookingRecordId =
        String(
          row.booking_record_id
        );
    }

    if (
      !booking.clinicId &&
      clinicId
    ) {
      booking.clinicId =
        clinicId;
    }

    return {
      sessionId:
        String(
          row.session_id ||
          resolvedSessionId
        ),
      clinicId,
      booking
    };
  }

  async function saveBookingSession({
    sessionId,
    clinicId = "",
    booking
  }) {
    const resolvedSessionId =
      String(sessionId || "").trim();

    if (!resolvedSessionId) {
      throw new Error(
        "Booking persistence requires sessionId"
      );
    }

    if (
      !booking ||
      typeof booking !== "object" ||
      Array.isArray(booking)
    ) {
      throw new Error(
        "Booking persistence requires booking"
      );
    }

    const resolvedClinicId =
      String(
        clinicId ||
        booking.clinicId ||
        ""
      ).trim();

    const payload = {
      session_id:
        resolvedSessionId,
      clinic_id:
        resolvedClinicId,
      booking_record_id:
        String(
          booking.bookingRecordId ||
          ""
        ),
      booking_data: {
        ...booking
      },
      updated_at: now()
    };

    const rows =
      await supabaseRequest(
        "/rest/v1/booking_sessions" +
          "?on_conflict=session_id",
        {
          method: "POST",
          headers: {
            Prefer:
              "resolution=merge-duplicates," +
              "return=representation"
          },
          body:
            JSON.stringify(
              payload
            )
        }
      );

    return Array.isArray(rows)
      ? rows[0] || payload
      : payload;
  }

  async function hydrateBookingSession({
    sessionId,
    patientBookings,
    sessionClinicId
  }) {
    const resolvedSessionId =
      String(sessionId || "").trim();

    if (!resolvedSessionId) {
      return null;
    }

    if (
      patientBookings &&
      patientBookings[
        resolvedSessionId
      ]
    ) {
      return patientBookings[
        resolvedSessionId
      ];
    }

    const persisted =
      await loadBookingSession(
        resolvedSessionId
      );

    if (!persisted) {
      return null;
    }

    if (patientBookings) {
      patientBookings[
        resolvedSessionId
      ] = persisted.booking;
    }

    if (
      sessionClinicId &&
      persisted.clinicId
    ) {
      sessionClinicId[
        resolvedSessionId
      ] = persisted.clinicId;
    }

    return persisted.booking;
  }

  return {
    loadBookingSession,
    saveBookingSession,
    hydrateBookingSession
  };
}

module.exports = {
  createBookingPersistence
};
