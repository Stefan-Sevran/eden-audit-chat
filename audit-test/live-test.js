const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const API_BASE =
  process.env.EDEN_AUDIT_API_BASE ||
  'https://eden-audit-chat.onrender.com';

const fixtureName = process.argv[2] || 'digital-dental-pattaya';

const fixturePath = path.resolve(
  __dirname,
  'fixtures',
  fixtureName.endsWith('.json') ? fixtureName : fixtureName + '.json'
);

if (!fs.existsSync(fixturePath)) {
  console.error(`Fixture not found: ${fixturePath}`);
  process.exit(1);
}

const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const sessionId =
  'eden_auto_' +
  fixtureName.replace(/[^a-z0-9]+/gi, '_') +
  '_' +
  Date.now() +
  '_' +
  crypto.randomBytes(4).toString('hex');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findPublicToken(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return null;
  if (seen.has(value)) return null;
  seen.add(value);

  if (typeof value.publicToken === 'string' && value.publicToken) {
    return value.publicToken;
  }

  if (typeof value.public_token === 'string' && value.public_token) {
    return value.public_token;
  }

  for (const child of Object.values(value)) {
    const found = findPublicToken(child, seen);
    if (found) return found;
  }

  return null;
}

async function jsonRequest(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Non-JSON response from ${url}: HTTP ${response.status}\n${text.slice(0, 1000)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${JSON.stringify(data, null, 2)}`
    );
  }

  return data;
}

async function submitFixture() {
  const answeredFields = [
    'monthlyWebFormInquiries',
    'monthlyMessengerTextInquiries',
    'monthlyMissedDelayedInquiries',
    'monthlyMissedCalls',
    'leadToBookingRate',
    'attendanceRate',
    'averageNewPatientValue'
  ];

  const payload = {
    sessionId,
    ...fixture.fields,
    answeredFields,
    ownerConfirmed: true,
    confirmationEvidence:
      'Yes, I confirm these simulated Eden QA test inputs.'
  };

  console.log('');
  console.log('EDEN AUTOMATED LIVE AUDIT');
  console.log('==========================');
  console.log(`Clinic:  ${fixture.name}`);
  console.log(`Session: ${sessionId}`);
  console.log('');
  console.log('Submitting confirmed intake...');

  return jsonRequest(`${API_BASE}/audit-voice-intake`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.EDEN_AUDIT_BENCHMARK_KEY
        ? {
            'x-eden-benchmark-key':
              process.env.EDEN_AUDIT_BENCHMARK_KEY
          }
        : {})
    },
    body: JSON.stringify(payload)
  });
}

async function poll(publicToken) {
  const started = Date.now();
  const timeoutMs = Number(
    process.env.EDEN_AUDIT_TEST_TIMEOUT_MS || 25 * 60 * 1000
  );

  let lastState = '';
  let temporaryErrors = 0;

  console.log('');
  console.log(`Public token: ${publicToken}`);
  console.log('Watching production job...');
  console.log('');

  while (Date.now() - started < timeoutMs) {
    try {
      const status = await jsonRequest(
        `${API_BASE}/audit-job-status/${encodeURIComponent(publicToken)}`
      );

      temporaryErrors = 0;

      const state =
        `${status.status || 'unknown'} / ${status.stage || 'unknown'}`;

      if (state !== lastState) {
        const seconds = Math.round((Date.now() - started) / 1000);
        console.log(`[${seconds}s] ${state}`);
        lastState = state;
      }

      if (status.status === 'review') {
        console.log('');
        console.log('✅ LIVE AUDIT PASS');
        console.log('Production scanner reached human review.');
        console.log(
          `Duration: ${Math.round((Date.now() - started) / 1000)} seconds`
        );
        process.exit(0);
      }

      if (status.status === 'published') {
        console.log('');
        console.log('✅ LIVE AUDIT PASS');
        console.log('Job is already published.');
        console.log(`Report: ${status.reportUrl || 'available'}`);
        process.exit(0);
      }

      if (status.status === 'failed') {
        console.log('');
        console.log('❌ LIVE AUDIT FAILED');
        console.log(
          'The production job reached failed status. Check Render/Supabase for last_error.'
        );
        process.exit(2);
      }
    } catch (error) {
      temporaryErrors += 1;

      if (temporaryErrors === 1 || temporaryErrors % 6 === 0) {
        console.log(
          `Status check temporarily unavailable (${temporaryErrors}): ${error.message}`
        );
      }
    }

    await sleep(5000);
  }

  console.log('');
  console.log('⏱ LIVE AUDIT TIMEOUT');
  console.log('Job did not reach review within the configured timeout.');
  process.exit(3);
}

(async () => {
  try {
    const result = await submitFixture();

    console.log('Intake accepted.');

    const publicToken = findPublicToken(result);

    if (!publicToken) {
      console.log('');
      console.log(
        '⚠️ Intake endpoint accepted the request but did not expose a public job token.'
      );
      console.log('');
      console.log('Server response:');
      console.log(JSON.stringify(result, null, 2));
      console.log('');
      console.log(
        'Check audit_jobs in Supabase. A brand-new eden_auto_* session should exist.'
      );
      process.exit(4);
    }

    await poll(publicToken);
  } catch (error) {
    console.error('');
    console.error('❌ AUTOMATED AUDIT TEST ERROR');
    console.error(error.message || error);
    process.exit(1);
  }
})();
