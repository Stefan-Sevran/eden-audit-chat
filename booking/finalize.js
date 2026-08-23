const {
  hasRequiredBookingDetails
} = require("./validation");

function createBookingFinalizer({
  ensurePatientBooking,
  normalizePhoneForClinic,
  ensureBookingRecordId,
  applyLiveServicePriceToBooking,
  createBookingTelegramCard,
  saveBookingToGoogleSheets,
  sendTelegramTo,
  logger = console
}) {
  async function finalizePatientBooking(
    sessionId,
    clinic,
    options = {}
  ) {
    const booking =
      ensurePatientBooking(
        sessionId,
        clinic.clinicId
      );

    booking.phone =
      normalizePhoneForClinic(
        booking.phone,
        clinic
      );

    booking.whatsapp =
      normalizePhoneForClinic(
        booking.whatsapp,
        clinic
      );

    if (
      !hasRequiredBookingDetails(
        booking
      )
    ) {
      return {
        success: false,
        reason:
          "MISSING_REQUIRED_BOOKING_DETAILS"
      };
    }

    const bookingRecordId =
      ensureBookingRecordId(
        sessionId,
        clinic
      );

    if (!bookingRecordId) {
      return {
        success: false,
        reason: "INVALID_BOOKING"
      };
    }

    await applyLiveServicePriceToBooking(
      sessionId,
      clinic
    );

    const telegramChatId =
      clinic.telegram?.bookingChatId;

    if (!telegramChatId) {
      return {
        success: false,
        reason:
          "TELEGRAM_DESTINATION_MISSING",
        bookingRecordId
      };
    }

    const message =
      createBookingTelegramCard(
        sessionId,
        bookingRecordId,
        options
      );

    if (!message) {
      return {
        success: false,
        reason: "BOOKING_CARD_FAILED",
        bookingRecordId
      };
    }

    await saveBookingToGoogleSheets(
      sessionId,
      bookingRecordId
    );

    await sendTelegramTo(
      telegramChatId,
      message
    );

    logger.log(
      "Booking finalized:",
      clinic.clinicName,
      bookingRecordId,
      sessionId
    );

    return {
      success: true,
      bookingRecordId
    };
  }

  return {
    finalizePatientBooking
  };
}

module.exports = {
  createBookingFinalizer
};
