const assert = require('node:assert/strict');

function makeReservationEngine() {
  const jobs = new Map();

  function addJob(job) {
    jobs.set(job.publicToken, {
      id: job.id,
      publicToken: job.publicToken,
      sessionId: job.sessionId,
      domain: job.domain || '',
      ipHash: job.ipHash || '',
      status: job.status || 'queued',
      launchState: job.launchState || 'unreserved',
      launchReservedAt: job.launchReservedAt || null
    });
  }

  function reserve({
    publicToken,
    ipHash = '',
    domain = '',
    ipLimit = 3,
    globalLimit = 50,
    domainCooldownHours = 24,
    now = Date.now()
  }) {
    const job = jobs.get(publicToken);

    if (!job) {
      return { allowed: false, reason: 'job_not_found' };
    }

    if (['reserved', 'launched'].includes(job.launchState)) {
      return {
        allowed: false,
        reason: 'already_reserved_or_launched',
        jobId: job.id
      };
    }

    if (job.launchState === 'blocked') {
      return {
        allowed: false,
        reason: 'already_blocked',
        jobId: job.id
      };
    }

    if (job.status !== 'queued') {
      return {
        allowed: false,
        reason: 'job_not_queued',
        jobId: job.id
      };
    }

    const cooldownMs = domainCooldownHours * 60 * 60 * 1000;

    if (
      domain &&
      [...jobs.values()].some(other =>
        other.id !== job.id &&
        other.domain === domain &&
        ['queued', 'scanning'].includes(other.status) &&
        ['reserved', 'launched'].includes(other.launchState)
      )
    ) {
      job.launchState = 'blocked';

      return {
        allowed: false,
        reason: 'domain_active',
        jobId: job.id
      };
    }

    if (
      domain &&
      [...jobs.values()].some(other =>
        other.id !== job.id &&
        other.domain === domain &&
        other.launchReservedAt &&
        now - other.launchReservedAt < cooldownMs &&
        ['reserved', 'launched'].includes(other.launchState)
      )
    ) {
      job.launchState = 'blocked';

      return {
        allowed: false,
        reason: 'domain_cooldown',
        jobId: job.id
      };
    }

    const ipCount = [...jobs.values()].filter(other =>
      other.ipHash === ipHash &&
      other.launchReservedAt &&
      now - other.launchReservedAt < 24 * 60 * 60 * 1000 &&
      ['reserved', 'launched'].includes(other.launchState)
    ).length;

    if (ipHash && ipCount >= ipLimit) {
      job.launchState = 'blocked';

      return {
        allowed: false,
        reason: 'ip_daily_limit',
        jobId: job.id
      };
    }

    const globalCount = [...jobs.values()].filter(other =>
      other.launchReservedAt &&
      now - other.launchReservedAt < 24 * 60 * 60 * 1000 &&
      ['reserved', 'launched'].includes(other.launchState)
    ).length;

    if (globalCount >= globalLimit) {
      job.launchState = 'blocked';

      return {
        allowed: false,
        reason: 'global_daily_limit',
        jobId: job.id
      };
    }

    job.domain = domain;
    job.ipHash = ipHash;
    job.launchState = 'reserved';
    job.launchReservedAt = now;

    return {
      allowed: true,
      reason: 'reserved',
      jobId: job.id
    };
  }

  return { addJob, reserve };
}

async function testDuplicateReservationBlocked() {
  const engine = makeReservationEngine();

  engine.addJob({
    id: 'job-a',
    publicToken: 'token-a'
  });

  const first = engine.reserve({
    publicToken: 'token-a',
    ipHash: 'ip-1',
    domain: 'clinic-a.com'
  });

  const second = engine.reserve({
    publicToken: 'token-a',
    ipHash: 'ip-1',
    domain: 'clinic-a.com'
  });

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  assert.equal(second.reason, 'already_reserved_or_launched');
}

async function testSameDomainActiveBlocked() {
  const engine = makeReservationEngine();

  engine.addJob({
    id: 'job-a',
    publicToken: 'token-a',
    domain: 'clinic.com',
    status: 'scanning',
    launchState: 'launched',
    launchReservedAt: Date.now()
  });

  engine.addJob({
    id: 'job-b',
    publicToken: 'token-b'
  });

  const result = engine.reserve({
    publicToken: 'token-b',
    domain: 'clinic.com',
    ipHash: 'ip-2'
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'domain_active');
}

async function testDomainCooldownBlocked() {
  const engine = makeReservationEngine();
  const now = Date.now();

  engine.addJob({
    id: 'job-a',
    publicToken: 'token-a',
    domain: 'clinic.com',
    status: 'review',
    launchState: 'launched',
    launchReservedAt: now - 60 * 60 * 1000
  });

  engine.addJob({
    id: 'job-b',
    publicToken: 'token-b'
  });

  const result = engine.reserve({
    publicToken: 'token-b',
    domain: 'clinic.com',
    ipHash: 'ip-2',
    now
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'domain_cooldown');
}

async function testIpLimitBlocked() {
  const engine = makeReservationEngine();
  const now = Date.now();

  for (let i = 0; i < 3; i++) {
    engine.addJob({
      id: `old-${i}`,
      publicToken: `old-token-${i}`,
      ipHash: 'same-ip',
      launchState: 'launched',
      launchReservedAt: now - 1000
    });
  }

  engine.addJob({
    id: 'job-new',
    publicToken: 'token-new'
  });

  const result = engine.reserve({
    publicToken: 'token-new',
    ipHash: 'same-ip',
    domain: 'fresh-clinic.com',
    ipLimit: 3,
    now
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'ip_daily_limit');
}

async function testGlobalLimitBlocked() {
  const engine = makeReservationEngine();
  const now = Date.now();

  for (let i = 0; i < 5; i++) {
    engine.addJob({
      id: `global-${i}`,
      publicToken: `global-token-${i}`,
      ipHash: `ip-${i}`,
      domain: `clinic-${i}.com`,
      launchState: 'launched',
      launchReservedAt: now - 1000
    });
  }

  engine.addJob({
    id: 'job-new',
    publicToken: 'token-new'
  });

  const result = engine.reserve({
    publicToken: 'token-new',
    ipHash: 'fresh-ip',
    domain: 'fresh-clinic.com',
    globalLimit: 5,
    now
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'global_daily_limit');
}

async function testDifferentClinicAllowed() {
  const engine = makeReservationEngine();

  engine.addJob({
    id: 'job-a',
    publicToken: 'token-a',
    domain: 'clinic-a.com',
    launchState: 'launched',
    launchReservedAt: Date.now()
  });

  engine.addJob({
    id: 'job-b',
    publicToken: 'token-b'
  });

  const result = engine.reserve({
    publicToken: 'token-b',
    ipHash: 'ip-b',
    domain: 'clinic-b.com'
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'reserved');
}

async function main() {
  const tests = [
    ['duplicate reservation is blocked', testDuplicateReservationBlocked],
    ['active same-domain scan is blocked', testSameDomainActiveBlocked],
    ['same-domain cooldown is enforced', testDomainCooldownBlocked],
    ['per-IP daily limit is enforced', testIpLimitBlocked],
    ['global daily limit is enforced', testGlobalLimitBlocked],
    ['different clinic still launches', testDifferentClinicAllowed]
  ];

  console.log('\nEDEN V2.6 LAUNCH REGRESSION');
  console.log('===========================');

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

  console.log(`\n${passed}/${tests.length} launch regression tests passed.`);

  if (passed !== tests.length) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
