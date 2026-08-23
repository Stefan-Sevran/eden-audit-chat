function normalizeComparable(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function shouldStartNewBooking({
  booking,
  bookingAction,
  patientName,
  service,
  requestedDate,
  requestedTime
}) {
  if (
    bookingAction !== "create" ||
    !booking?.bookingRecordId
  ) {
    return false;
  }

  const incomingPatientName =
    normalizeComparable(patientName);

  const existingPatientName =
    normalizeComparable(
      booking.patientName
    );

  const incomingService =
    normalizeComparable(service);

  const existingService =
    normalizeComparable(
      booking.serviceName
    );

  const incomingDate =
    String(requestedDate || "")
      .trim();

  const existingDate =
    String(
      booking.preferredDate || ""
    ).trim();

  const incomingTime =
    normalizeComparable(
      requestedTime
    );

  const existingTime =
    normalizeComparable(
      booking.preferredTime
    );

  return Boolean(
    (
      incomingPatientName &&
      existingPatientName &&
      incomingPatientName !==
        existingPatientName
    ) ||
    (
      incomingService &&
      existingService &&
      incomingService !==
        existingService
    ) ||
    (
      incomingDate &&
      existingDate &&
      incomingDate !==
        existingDate
    ) ||
    (
      incomingTime &&
      existingTime &&
      incomingTime !==
        existingTime
    )
  );
}

function applyBookingLifecycleDecision({
  booking,
  bookingAction,
  patientName,
  service,
  requestedDate,
  requestedTime,
  now = () =>
    new Date().toISOString()
}) {
  const isClearlyDifferentBooking =
    shouldStartNewBooking({
      booking,
      bookingAction,
      patientName,
      service,
      requestedDate,
      requestedTime
    });

  if (isClearlyDifferentBooking) {
    booking.bookingRecordId = "";
    booking.createdAt = now();
  }

  return {
    isClearlyDifferentBooking
  };
}

module.exports = {
  shouldStartNewBooking,
  applyBookingLifecycleDecision
};
