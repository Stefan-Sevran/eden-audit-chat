function hasBookingContact(booking) {
  return Boolean(
    booking?.phone ||
    booking?.whatsapp ||
    booking?.email
  );
}

function hasRequiredBookingDetails(booking) {
  return Boolean(
    booking?.patientName &&
    hasBookingContact(booking) &&
    booking?.serviceName &&
    booking?.preferredDate &&
    booking?.preferredTime
  );
}

module.exports = {
  hasBookingContact,
  hasRequiredBookingDetails
};
