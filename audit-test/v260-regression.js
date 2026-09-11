const assert = require('node:assert/strict');

const {
  createAuditWorker
} = require('../audits/durable/audit-worker-v240');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeJob(overrides = {}) {
  return {
    id: overrides.id || 'job-a',
    session_id: overrides.session_id || 'session-a',
    public_token: overrides.public_token || 'token-a',
    status: overrides.status || 'queued',
    stage: overrides.stage || 'evidence',
    intake: overrides.intake || {
      clinic: {
        websiteUrl: 'https://example.com'
      }
    },
    delivery: null,
    attempts: overrides.attempts ?? 0,
    launch_state: overrides.launch_state || 'launched',
    lease_expires_at: null,
    ...overrides
  };
}

async function testTargetedWorkerClaimsExactJob() {
  const jobs = {
    'job-a': makeJob({ id: 'job-a' }),
    'job-b': makeJob({ id: 'job-b', session_id: 'session-b' })
  };

  const claimed = [];

  const store = {
    async claim() {
      throw new Error('generic claim() should not be used');
    },

    async claimById(jobId) {
      claimed.push(jobId);
      const job = jobs[jobId];
      if (!job) return null;
      job.status = 'scanning';
      job.attempts += 1;
      return clone(job);
    },

    async markReview(id) {
      jobs[id].status = 'review';
      jobs[id].stage = 'review';
      return clone(jobs[id]);
    },

    async renewLease() {}
  };

  const worker = createAuditWorker({
    auditJobStore: store,
    runEvidencePipeline: async ({ jobId }) => ({
      evidencePacket: { jobId },
      internal: { ok: true }
    }),
    workerId: 'test-worker'
  });

  const result = await worker.runOnce({ jobId: 'job-b' });

  assert.equal(result.claimed, true);
  assert.equal(result.jobId, 'job-b');
  assert.equal(result.status, 'review');
  assert.deepEqual(claimed, ['job-b']);
  assert.equal(jobs['job-a'].status, 'queued');
  assert.equal(jobs['job-b'].status, 'review');
}

async function testGenericFallbackStillWorks() {
  const job = makeJob();

  let genericCalled = 0;

  const store = {
    async claim() {
      genericCalled += 1;
      job.status = 'scanning';
      job.attempts += 1;
      return clone(job);
    },

    async markReview() {
      job.status = 'review';
      job.stage = 'review';
      return clone(job);
    },

    async renewLease() {}
  };

  const worker = createAuditWorker({
    auditJobStore: store,
    runEvidencePipeline: async () => ({
      evidencePacket: {},
      internal: {}
    })
  });

  const result = await worker.runOnce();

  assert.equal(genericCalled, 1);
  assert.equal(result.status, 'review');
}

async function testFailureRequeuesBeforeMaxAttempts() {
  const job = makeJob({ attempts: 1 });

  const store = {
    async claimById() {
      job.status = 'scanning';
      job.attempts += 1;
      return clone(job);
    },

    async retryOrFail(claimedJob, error, maxAttempts) {
      assert.equal(maxAttempts, 4);
      assert.match(error.message, /synthetic failure/);

      if (claimedJob.attempts < maxAttempts) {
        job.status = 'queued';
      } else {
        job.status = 'failed';
      }

      return clone(job);
    },

    async renewLease() {}
  };

  const worker = createAuditWorker({
    auditJobStore: store,
    runEvidencePipeline: async () => {
      throw new Error('synthetic failure');
    }
  });

  const result = await worker.runOnce({ jobId: job.id });

  assert.equal(result.claimed, true);
  assert.equal(result.status, 'queued');
}

async function testFourthFailureBecomesFinalFailure() {
  const job = makeJob({ attempts: 3 });

  const store = {
    async claimById() {
      job.status = 'scanning';
      job.attempts += 1;
      return clone(job);
    },

    async retryOrFail(claimedJob, error, maxAttempts) {
      assert.equal(claimedJob.attempts, 4);
      assert.equal(maxAttempts, 4);

      job.status = 'failed';
      return clone(job);
    },

    async renewLease() {}
  };

  const worker = createAuditWorker({
    auditJobStore: store,
    runEvidencePipeline: async () => {
      throw new Error('synthetic final failure');
    }
  });

  const result = await worker.runOnce({ jobId: job.id });

  assert.equal(result.status, 'failed');
}

async function testUnclaimableTargetReturnsCleanly() {
  let pipelineRan = false;

  const store = {
    async claimById() {
      return null;
    }
  };

  const worker = createAuditWorker({
    auditJobStore: store,
    runEvidencePipeline: async () => {
      pipelineRan = true;
    }
  });

  const result = await worker.runOnce({ jobId: 'blocked-job' });

  assert.equal(result.claimed, false);
  assert.equal(pipelineRan, false);
}

async function main() {
  const tests = [
    ['targeted worker claims only exact job', testTargetedWorkerClaimsExactJob],
    ['generic worker fallback still works', testGenericFallbackStillWorks],
    ['failed attempt requeues before max attempts', testFailureRequeuesBeforeMaxAttempts],
    ['fourth failure becomes final failure', testFourthFailureBecomesFinalFailure],
    ['blocked/unclaimable target does not run pipeline', testUnclaimableTargetReturnsCleanly]
  ];

  console.log('\nEDEN V2.6 REGRESSION\n====================');

  let passed = 0;

  for (const [name, fn] of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`✅ ${name}`);
    } catch (error) {
      console.error(`❌ ${name}`);
      console.error(error);
      process.exitCode = 1;
    }
  }

  console.log(`\n${passed}/${tests.length} regression tests passed.`);

  if (passed !== tests.length) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
