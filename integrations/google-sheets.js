async function postJsonToGoogleSheets(
  url,
  payload
) {
  if (!url) {
    return {
      ok: false,
      error:
        "Google Sheets URL missing"
    };
  }

  try {
    const response = await fetch(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json"
        },
        body:
          JSON.stringify(payload)
      }
    );

    const result =
      await response
        .json()
        .catch(() => null);

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        result
      };
    }

    return {
      ok: true,
      status: response.status,
      result
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  }
}

module.exports = {
  postJsonToGoogleSheets
};
