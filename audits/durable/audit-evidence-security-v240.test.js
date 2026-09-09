const assert = require('node:assert/strict');

const {
  createAuditEvidenceReview,
  normalizeRelativePath
} = require('./audit-evidence-review-v240');

const {
  createAuditJobStore
} = require('./audit-job-store-v240');

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return body === undefined
        ? ''
        : JSON.stringify(body);
    }
  };
}

async function expectReject(fn, messagePart, statusCode) {
  let error = null;

  try {
    await fn();
  } catch (err) {
    error = err;
  }

  assert.ok(error, 'Expected operation to reject.');

  if (messagePart) {
    assert.match(error.message, new RegExp(messagePart, 'i'));
  }

  if (statusCode !== undefined) {
    assert.equal(error.statusCode, statusCode);
  }
}

async function run() {
  // ------------------------------------------------------------
  // 1. Relative path normalization
  // ------------------------------------------------------------
  assert.equal(
    normalizeRelativePath('screens/homepage.png'),
    'screens/homepage.png'
  );

  assert.equal(
    normalizeRelativePath('/screens/homepage.png'),
    'screens/homepage.png'
  );

  assert.throws(
    () => normalizeRelativePath('../secret.txt'),
    /Invalid evidence path/
  );

  assert.throws(
    () => normalizeRelativePath('screens/../secret.txt'),
    /Invalid evidence path/
  );

  assert.throws(
    () => normalizeRelativePath('screens/./homepage.png'),
    /Invalid evidence path/
  );

  assert.throws(
    () => normalizeRelativePath(''),
    /valid evidence path/
  );

  // ------------------------------------------------------------
  // 2. Successful signed URL
  // ------------------------------------------------------------
  {
    const calls = [];

    const review = createAuditEvidenceReview({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-secret',
      fetchImpl: async (url, options = {}) => {
        calls.push({ url, options });

        if (url.includes('/rest/v1/audit_jobs')) {
          return response(200, [{
            id: 'job-123',
            status: 'review',
            evidence_packet: null,
            internal_result: {
              durableEvidence: {
                bucket: 'audit-evidence',
                prefix: 'job-123'
              }
            }
          }]);
        }

        if (url.includes('/storage/v1/object/sign/')) {
          return response(200, {
            signedURL:
              '/storage/v1/object/sign/audit-evidence/job-123/homepage.png?token=abc'
          });
        }

        return response(404, { message: 'Unexpected request' });
      }
    });

    const result = await review.signEvidence({
      jobId: 'job-123',
      relativePath: 'homepage.png'
    });

    assert.equal(result.jobId, 'job-123');
    assert.equal(result.path, 'homepage.png');
    assert.equal(result.expiresIn, 300);

    assert.equal(
      result.signedUrl,
      'https://example.supabase.co/storage/v1/object/sign/audit-evidence/job-123/homepage.png?token=abc'
    );

    assert.equal(calls.length, 2);

    const signCall = calls[1];

    assert.match(
      signCall.url,
      /audit-evidence\/job-123\/homepage\.png/
    );

    assert.equal(signCall.options.method, 'POST');

    assert.deepEqual(
      JSON.parse(signCall.options.body),
      { expiresIn: 300 }
    );
  }

  // ------------------------------------------------------------
  // 3. Missing job => 404
  // ------------------------------------------------------------
  {
    const review = createAuditEvidenceReview({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-secret',
      fetchImpl: async () => response(200, [])
    });

    await expectReject(
      () => review.signEvidence({
        jobId: 'missing-job',
        relativePath: 'homepage.png'
      }),
      'Audit job not found',
      404
    );
  }

  // ------------------------------------------------------------
  // 4. Job exists but durable evidence not ready => 409
  // ------------------------------------------------------------
  {
    const review = createAuditEvidenceReview({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-secret',
      fetchImpl: async () => response(200, [{
        id: 'job-123',
        status: 'review',
        evidence_packet: null,
        internal_result: null
      }])
    });

    await expectReject(
      () => review.signEvidence({
        jobId: 'job-123',
        relativePath: 'homepage.png'
      }),
      'Durable evidence is not available',
      409
    );
  }

  // ------------------------------------------------------------
  // 5. Stored prefix cannot point to another Audit job
  // ------------------------------------------------------------
  {
    const review = createAuditEvidenceReview({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-secret',
      fetchImpl: async () => response(200, [{
        id: 'job-123',
        status: 'review',
        internal_result: {
          durableEvidence: {
            bucket: 'audit-evidence',
            prefix: 'job-OTHER'
          }
        }
      }])
    });

    await expectReject(
      () => review.signEvidence({
        jobId: 'job-123',
        relativePath: 'homepage.png'
      }),
      'manifest failed validation'
    );
  }

  // ------------------------------------------------------------
  // 6. Stored bucket cannot escape audit-evidence
  // ------------------------------------------------------------
  {
    const review = createAuditEvidenceReview({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-secret',
      fetchImpl: async () => response(200, [{
        id: 'job-123',
        status: 'review',
        internal_result: {
          durableEvidence: {
            bucket: 'some-other-private-bucket',
            prefix: 'job-123'
          }
        }
      }])
    });

    await expectReject(
      () => review.signEvidence({
        jobId: 'job-123',
        relativePath: 'homepage.png'
      }),
      'manifest failed validation'
    );
  }

  // ------------------------------------------------------------
  // 7. Admin middleware is mandatory for reviewer route
  // ------------------------------------------------------------
  {
    const review = createAuditEvidenceReview({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-secret',
      fetchImpl: async () => response(200, {})
    });

    assert.throws(
      () => review.registerReviewRoutes(
        { post() {} },
        null
      ),
      /requires admin middleware/
    );
  }

  // ------------------------------------------------------------
  // 8. Public job status must not expose private evidence
  // ------------------------------------------------------------
  {
    const store = createAuditJobStore({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-secret',
      fetchImpl: async () => response(200, [])
    });

    const publicResult = store.publicView({
      public_token: 'public-token-123',
      status: 'review',
      stage: 'review',
      report_url: null,
      updated_at: '2026-09-09T00:00:00Z',

      // These must never leak into publicView:
      intake: { secret: true },
      delivery: { email: 'owner@example.com' },
      evidence_packet: {
        durableEvidence: {
          bucket: 'audit-evidence',
          prefix: 'job-123'
        }
      },
      internal_result: {
        serviceSecret: 'do-not-leak'
      },
      worker_id: 'worker-secret',
      last_error: 'internal-error'
    });

    assert.deepEqual(publicResult, {
      publicToken: 'public-token-123',
      status: 'review',
      stage: 'review',
      reportUrl: null,
      updatedAt: '2026-09-09T00:00:00Z'
    });

    assert.equal(
      JSON.stringify(publicResult).includes('audit-evidence'),
      false
    );

    assert.equal(
      JSON.stringify(publicResult).includes('owner@example.com'),
      false
    );

    assert.equal(
      JSON.stringify(publicResult).includes('do-not-leak'),
      false
    );
  }

  console.log(
    'PASS: V2.4 private evidence signing, traversal protection, job isolation and public-view security.'
  );
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
