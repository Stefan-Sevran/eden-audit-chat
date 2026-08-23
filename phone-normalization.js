function normalizeGenericPhone(value) {
  const raw = String(value || "").trim();

  if (!raw) return "";

  // Reject obvious appointment dates accidentally put in contact fields.
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return "";
  }

  return raw;
}

function normalizeThaiPhone(value) {
  const raw = String(value || "").trim();

  if (!raw) return "";

  // Reject obvious appointment dates accidentally put in contact fields.
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return "";
  }

  const digits = raw.replace(/\D/g, "");

  // 66989252310
  if (
    digits.startsWith("66") &&
    digits.length === 11
  ) {
    const local = digits.slice(2);

    return (
      "+66 " +
      local.slice(0, 2) +
      " " +
      local.slice(2, 5) +
      " " +
      local.slice(5)
    );
  }

  // 0989252310
  if (
    digits.startsWith("0") &&
    digits.length === 10
  ) {
    const local = digits.slice(1);

    return (
      "+66 " +
      local.slice(0, 2) +
      " " +
      local.slice(2, 5) +
      " " +
      local.slice(5)
    );
  }

  // 989252310
  if (digits.length === 9) {
    return (
      "+66 " +
      digits.slice(0, 2) +
      " " +
      digits.slice(2, 5) +
      " " +
      digits.slice(5)
    );
  }

  // Unknown format: preserve rather than invent.
  return raw;
}

function normalizePhoneForClinic(value, clinic) {
  const countryCode =
    String(clinic?.countryCode || "")
      .trim()
      .toUpperCase();

  if (countryCode === "TH") {
    return normalizeThaiPhone(value);
  }

  return normalizeGenericPhone(value);
}

module.exports = {
  normalizeGenericPhone,
  normalizeThaiPhone,
  normalizePhoneForClinic
};