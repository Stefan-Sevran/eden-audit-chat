const {
  buildBookingRecordId
} = require("../booking-id");

function createBookingState({
  patientBookings,
  sessionClinicId
}) {
  function ensurePatientBooking(
    sessionId,
    clinicId = ""
  ) {
    const resolvedClinicId =
      clinicId ||
      sessionClinicId[sessionId] ||
      "";

    if (!patientBookings[sessionId]) {
      patientBookings[sessionId] = {
        leadId: "",
        bookingRecordId: "",
        clinicId: resolvedClinicId,
        patientName: "",
        phone: "",
        whatsapp: "",
        email: "",
        preferredContactMethod: "",
        serviceId: "",
        serviceName: "",
        preferredDate: "",
        preferredTime: "",
        bookingStatus: "NEW",
        estimatedVisitValue: 0,
        potentialServiceName: "",
        potentialServiceValueMin: 0,
        potentialServiceValueMax: 0,
        humanFollowUpNeeded: false,
        humanTeamUsed: false,
        urgency: "NORMAL",
        summary: "",
        source: "AI_CHAT",
        lifecycleStatus: "",
        reminderStatus:
          "PENDING_CLINIC_CONFIRMATION",
        reminderDueAt: "",
        attendanceCheckDueAt: "",
        attendanceStatus:
          "ATTENDANCE_UNVERIFIED",
        treatmentDecisionCheckDueAt: "",
        lastPatientReply: "",
        reminderMessage: "",
        attendanceMessage: "",
        createdAt:
          new Date().toISOString(),
        updatedAt:
          new Date().toISOString()
      };
    }

    if (
      !patientBookings[sessionId].clinicId
    ) {
      patientBookings[sessionId].clinicId =
        resolvedClinicId;
    }

    return patientBookings[sessionId];
  }

  function getBookingRecordSignature(
    booking
  ) {
    return [
      booking.serviceId ||
        booking.serviceName ||
        "",
      booking.preferredDate || "",
      booking.preferredTime || ""
    ]
      .map(function(value) {
        return String(value || "")
          .trim()
          .toLowerCase();
      })
      .join("|");
  }

  function ensureBookingRecordId(
    sessionId,
    clinic
  ) {
    const booking =
      ensurePatientBooking(
        sessionId,
        clinic?.clinicId || ""
      );

    if (
      !booking.serviceName ||
      !booking.preferredDate ||
      !booking.preferredTime
    ) {
      return "";
    }

    if (!booking.bookingRecordId) {
      booking.bookingRecordId =
        buildBookingRecordId({
          sessionId,
          createdAt:
            booking.createdAt,
          clinicCode:
            clinic?.clinicCode ||
            "BOOK",
          preferredDate:
            booking.preferredDate
        });
    }

    return booking.bookingRecordId;
  }

  return {
    ensurePatientBooking,
    getBookingRecordSignature,
    ensureBookingRecordId
  };
}

module.exports = {
  createBookingState
};
