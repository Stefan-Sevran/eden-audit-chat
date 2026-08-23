function createSupabaseClient({
  supabaseUrl,
  supabaseServiceRoleKey
}) {
  const resolvedUrl =
    String(supabaseUrl || "")
      .replace(/\/$/, "");

  const resolvedKey =
    String(
      supabaseServiceRoleKey || ""
    );

  function supabaseConfigured() {
    return Boolean(
      resolvedUrl &&
      resolvedKey
    );
  }

  async function supabaseRequest(
    path,
    options = {}
  ) {
    if (!supabaseConfigured()) {
      throw new Error(
        "Supabase is not configured."
      );
    }

    const response =
      await fetch(
        resolvedUrl + path,
        {
          ...options,
          headers: {
            apikey:
              resolvedKey,
            Authorization:
              "Bearer " +
              resolvedKey,
            "Content-Type":
              "application/json",
            ...(options.headers || {})
          }
        }
      );

    const responseText =
      await response.text();

    let payload = null;

    try {
      payload =
        responseText
          ? JSON.parse(
              responseText
            )
          : null;
    } catch (error) {
      payload =
        responseText;
    }

    if (!response.ok) {
      throw new Error(
        "Supabase " +
        response.status +
        ": " +
        (
          typeof payload ===
          "string"
            ? payload
            : JSON.stringify(
                payload
              )
        )
      );
    }

    return payload;
  }

  return {
    supabaseConfigured,
    supabaseRequest
  };
}

module.exports = {
  createSupabaseClient
};
