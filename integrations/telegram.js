const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN;

const TELEGRAM_CHAT_ID =
  process.env.TELEGRAM_CHAT_ID;

async function sendTelegramTo(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN || !chatId) {
    console.error(
      "Telegram configuration missing:",
      {
        hasBotToken: Boolean(
          TELEGRAM_BOT_TOKEN
        ),
        chatId: chatId || "missing"
      }
    );

    return {
      ok: false,
      error:
        "Telegram token or chat ID missing"
    };
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify({
          chat_id:
            String(chatId).trim(),
          text:
            String(text).slice(0, 3900)
        })
      }
    );

    const data =
      await response.json();

    if (!response.ok || !data.ok) {
      console.error(
        "Telegram API rejected message:",
        JSON.stringify(
          data,
          null,
          2
        )
      );

      return {
        ok: false,
        status: response.status,
        data
      };
    }

    console.log(
      "Telegram message delivered:",
      chatId,
      data.result?.message_id
    );

    return {
      ok: true,
      data
    };
  } catch (error) {
    console.error(
      "Telegram delivery exception:",
      error
    );

    return {
      ok: false,
      error: error.message
    };
  }
}

async function sendTelegram(text) {
  if (
    !TELEGRAM_BOT_TOKEN ||
    !TELEGRAM_CHAT_ID
  ) {
    console.log(
      "Telegram env vars missing."
    );
    return;
  }

  await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json"
      },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text:
          String(text).slice(0, 3900)
      })
    }
  );
}

module.exports = {
  sendTelegramTo,
  sendTelegram
};
