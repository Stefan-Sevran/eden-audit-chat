function stableBookingHash(value) {
  let hash = 2166136261;

  for (
    let index = 0;
    index < value.length;
    index += 1
  ) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0)
    .toString(36)
    .toUpperCase();
}

function buildBookingRecordId({
  sessionId,
  createdAt,
  clinicCode,
  preferredDate
}) {
  if (
    !sessionId ||
    !createdAt ||
    !preferredDate
  ) {
    return "";
  }

  const datePart =
    String(preferredDate)
      .replace(/-/g, "")
      .slice(2);

  const resolvedClinicCode =
    clinicCode || "BOOK";

  return (
    `${resolvedClinicCode}-${datePart}-` +
    stableBookingHash(
      `${sessionId}|${createdAt}`
    ).slice(-6)
  );
}

module.exports = {
  stableBookingHash,
  buildBookingRecordId
};
