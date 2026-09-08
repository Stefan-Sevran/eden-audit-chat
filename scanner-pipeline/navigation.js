async function resilientGoto(page, url, options = {}) {
  const attempts = [];
  const primaryTimeoutMs = options.primaryTimeoutMs || options.timeoutMs || 30000;
  const fallbackTimeoutMs = options.fallbackTimeoutMs || Math.max(primaryTimeoutMs, 60000);
  const startedAt = Date.now();

  const plans = [
    { waitUntil: 'domcontentloaded', timeout: primaryTimeoutMs, label: 'domcontentloaded' },
    { waitUntil: 'commit', timeout: fallbackTimeoutMs, label: 'commit-fallback' }
  ];

  let response = null;
  let lastError = null;
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const attemptStarted = Date.now();
    try {
      response = await page.goto(url, { waitUntil: plan.waitUntil, timeout: plan.timeout });
      attempts.push({
        attempt: i + 1,
        strategy: plan.label,
        ok: true,
        status: response?.status() || null,
        durationMs: Date.now() - attemptStarted
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      attempts.push({
        attempt: i + 1,
        strategy: plan.label,
        ok: false,
        durationMs: Date.now() - attemptStarted,
        error: String(error.message || error).slice(0, 500)
      });
      if (i < plans.length - 1) {
        await page.waitForTimeout(500);
      }
    }
  }

  if (lastError) {
    const wrapped = new Error(`Navigation failed after ${attempts.length} strategy attempt(s): ${lastError.message || lastError}`);
    wrapped.cause = lastError;
    wrapped.navigationAttempts = attempts;
    throw wrapped;
  }

  // If the fast fallback returned on commit, allow DOM readiness to arrive without blocking forever.
  await page.waitForLoadState('domcontentloaded', { timeout: Math.min(fallbackTimeoutMs, 20000) }).catch(() => {});

  return {
    response,
    attempts,
    durationMs: Date.now() - startedAt,
    slowLoad: Date.now() - startedAt >= (options.slowThresholdMs || 8000),
    fallbackUsed: attempts.some(a => a.ok && a.strategy !== 'domcontentloaded')
  };
}

module.exports = { resilientGoto };
