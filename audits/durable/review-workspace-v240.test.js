const assert = require('node:assert/strict');

const {
  createAuditReviewWorkspace,
  safeRelativePath
} = require('./review-workspace-v240');

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
    async arrayBuffer() {
      return Buffer.from(JSON.stringify(body));
    }
  };
}

async function run() {
  assert.equal(
    safeRelativePath('screens/homepage.png'),
    'screens/homepage.png'
  );

  assert.throws(
    () => safeRelativePath('../secret.txt'),
    /path traversal rejected/
  );

  assert.throws(
    () => safeRelativePath('screens/../secret.txt'),
    /path traversal rejected/
  );

  {
    const workspace = createAuditReviewWorkspace({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-secret',
      fetchImpl: async () => response(200, [])
    });

    let error = null;

    try {
      await workspace.hydrate('missing-job');
    } catch (err) {
      error = err;
    }

    assert.ok(error);
    assert.match(error.message, /Audit job not found/);
  }

  {
    const workspace = createAuditReviewWorkspace({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-secret',
      fetchImpl: async () => response(200, [{
        id: 'job-123',
        public_token: 'tok',
        status: 'review',
        stage: 'review',
        evidence_packet: null,
        internal_result: null
      }])
    });

    let error = null;

    try {
      await workspace.hydrate('job-123');
    } catch (err) {
      error = err;
    }

    assert.ok(error);
    assert.match(
      error.message,
      /Durable evidence is not available/
    );
  }

  console.log(
    'PASS: V2.4 review workspace path safety and missing-evidence behavior.'
  );
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
