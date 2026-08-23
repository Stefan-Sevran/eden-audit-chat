const {
  hasBookingContact
} = require("./validation");

function applyBookingUpdate({
  booking,
  clinic,
  updates = {},
  resolveBookingDate,
  now = () => new Date().toISOString()
}) {
  if (!booking || !clinic) {
    return booking;
  }

  for (const key of [
    "patientName",
    "phone",
    "whatsapp",
    "email",
    "summary"
  ]) {
    if (
      typeof updates[key] === "string" &&
      updates[key].trim()
    ) {
      booking[key] =
        updates[key].trim();
    }
  }

  if (
    ["Phone", "WhatsApp", "Email"].includes(
      updates.preferredContactMethod
    )
  ) {
    booking.preferredContactMethod =
      updates.preferredContactMethod;
  }

  if (
    typeof updates.preferredTime === "string" &&
    updates.preferredTime.trim()
  ) {
    booking.preferredTime =
      updates.preferredTime.trim();
  }

  if (
    typeof updates.preferredDate === "string" &&
    updates.preferredDate.trim()
  ) {
    const resolvedDate =
      resolveBookingDate
        ? resolveBookingDate(
            updates.preferredDate.trim(),
            clinic.timezone
          )
        : updates.preferredDate.trim();

    if (resolvedDate) {
      booking.preferredDate =
        resolvedDate;
    }
  }

  if (
    [
      "NEW",
      "CONTACT_CAPTURED",
      "BOOKING_REQUESTED",
      "AWAITING_CLINIC"
    ].includes(
      updates.bookingStatus
    )
  ) {
    booking.bookingStatus =
      updates.bookingStatus;
  }

  if (
    ["NORMAL", "URGENT"].includes(
      updates.urgency
    )
  ) {
    booking.urgency =
      updates.urgency;
  }

  const service =
    (clinic.services || []).find(
      item =>
        item.id === updates.serviceId ||
        item.name.toLowerCase() ===
          String(
            updates.serviceName || ""
          ).toLowerCase()
    );

  if (service) {
    booking.serviceId =
      service.id;

    booking.serviceName =
      service.name;

    booking.estimatedVisitValue =
      service.estimatedVisitValue ||
      clinic.commercialModel?.defaultVisitValue ||
      0;

    booking.potentialServiceName =
      service.potentialServiceName || "";

    booking.potentialServiceValueMin =
      service.potentialServiceValueMin || 0;

    booking.potentialServiceValueMax =
      service.potentialServiceValueMax || 0;

    if (service.urgent) {
      booking.urgency = "URGENT";
    }
  }

  if (
    booking.whatsapp &&
    !booking.phone
  ) {
    booking.phone =
      booking.whatsapp;
  }

  if (!booking.preferredContactMethod) {
    booking.preferredContactMethod =
      booking.whatsapp
        ? "WhatsApp"
        : booking.phone
          ? "Phone"
          : booking.email
            ? "Email"
            : "";
  }

  if (
    booking.patientName &&
    hasBookingContact(booking) &&
    booking.bookingStatus === "NEW"
  ) {
    booking.bookingStatus =
      "CONTACT_CAPTURED";
  }

  if (
    booking.serviceName &&
    booking.preferredDate &&
    booking.preferredTime
  ) {
    booking.bookingStatus =
      "AWAITING_CLINIC";
  }

  booking.humanFollowUpNeeded =
    booking.bookingStatus ===
    "AWAITING_CLINIC";

  booking.updatedAt =
    now();

  return booking;
}

module.exports = {
  applyBookingUpdate
};
