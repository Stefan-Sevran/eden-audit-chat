const crypto = require('node:crypto');

function cleanBase(value) {
  return String(value || '').replace(/\/$/, '');
}

function createAuditJobStore({ supabaseUrl, serviceRoleKey, fetchImpl = global.fetch } = {}) {
  const base = cleanBase(supabaseUrl);
  const key = String(serviceRoleKey || '');
  const configured = Boolean(base && key && typeof fetchImpl === 'function');

  async function request(path, { method = 'GET', body, headers = {} } = {}) {
    if (!configured) throw new Error('Audit job store is not configured.');
    const response = await fetchImpl(base + path, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = data?.message || data?.error || `Supabase request failed: ${response.status}`;
      throw new Error(message);
    }
    return data;
  }

  function publicView(row) {
    if (!row) return null;
    return {
      publicToken: row.public_token,
      status: row.status,
      stage: row.stage,
      reportUrl: row.report_url || null,
      updatedAt: row.updated_at || null
    };
  }

  async function enqueue({ sessionId, intake, delivery = null, source = 'mia-confirmed-intake' } = {}) {
    if (!sessionId) throw new Error('sessionId is required.');
    if (!intake || typeof intake !== 'object') throw new Error('Confirmed intake payload is required.');
    const row = {
      session_id: String(sessionId),
      public_token: crypto.randomBytes(24).toString('hex'),
      status: 'queued',
      stage: 'evidence',
      intake,
      delivery,
      source,
      attempts: 0,
      last_error: null,
      report_url: null,
      updated_at: new Date().toISOString()
    };
    const data = await request('/rest/v1/audit_jobs?on_conflict=session_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: row
    });
    const created = Array.isArray(data) ? data[0] || null : data || null;
    if (created) return created;

    // Idempotency: a repeated confirmation for the same session must
    // return the existing durable job without resetting its token,
    // status, attempts, launch state, or scan progress.
    const existing = await request(
      `/rest/v1/audit_jobs?session_id=eq.${encodeURIComponent(String(sessionId))}&limit=1`
    );

    return Array.isArray(existing)
      ? existing[0] || null
      : existing || null;
  }

  async function getPublic(publicToken) {
    const token = encodeURIComponent(String(publicToken || ''));
    if (!token) return null;
    const select = encodeURIComponent('public_token,status,stage,report_url,updated_at');
    const data = await request(`/rest/v1/audit_jobs?public_token=eq.${token}&select=${select}&limit=1`);
    return Array.isArray(data) ? data[0] || null : null;
  }

  async function claim(workerId = `worker-${process.pid}`) {
    const data = await request('/rest/v1/rpc/claim_audit_job', {
      method: 'POST',
      body: { p_worker_id: String(workerId) }
    });
    return Array.isArray(data) ? data[0] || null : data || null;
  }

  async function claimById(jobId, workerId = `worker-${process.pid}`) {
    if (!jobId) throw new Error('Audit job id is required.');

    const data = await request('/rest/v1/rpc/claim_audit_job_by_id', {
      method: 'POST',
      body: {
        p_job_id: String(jobId),
        p_worker_id: String(workerId)
      }
    });

    return Array.isArray(data) ? data[0] || null : data || null;
  }

  async function reserveLaunch({
    publicToken,
    ipHash = '',
    domain = '',
    ipLimit = 3,
    globalLimit = 50,
    domainCooldownHours = 24
  } = {}) {
    if (!publicToken) throw new Error('Audit public token is required.');

    const data = await request('/rest/v1/rpc/reserve_audit_launch', {
      method: 'POST',
      body: {
        p_public_token: String(publicToken),
        p_ip_hash: String(ipHash || ''),
        p_domain: String(domain || ''),
        p_ip_limit: Number(ipLimit),
        p_global_limit: Number(globalLimit),
        p_domain_cooldown_hours: Number(domainCooldownHours)
      }
    });

    return Array.isArray(data) ? data[0] || null : data || null;
  }

  async function update(id, patch) {
    if (!id) throw new Error('Audit job id is required.');
    const data = await request(`/rest/v1/audit_jobs?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: { ...patch, updated_at: new Date().toISOString() }
    });
    return Array.isArray(data) ? data[0] || null : data;
  }

  async function markReview(id, { evidencePacket = null, internal = null } = {}) {
    return update(id, {
      status: 'review',
      stage: 'review',
      evidence_packet: evidencePacket,
      internal_result: internal,
      last_error: null,
      lease_expires_at: null
    });
  }

  async function markPublished(id, { reportUrl, report = null } = {}) {
    if (!reportUrl) throw new Error('reportUrl is required to publish an Audit job.');
    return update(id, {
      status: 'published',
      stage: 'report',
      report_url: reportUrl,
      report,
      completed_at: new Date().toISOString(),
      last_error: null,
      lease_expires_at: null
    });
  }

  async function markFailed(id, error) {
    const message = String(error?.message || error || 'Audit worker failed').slice(0, 4000);
    return update(id, {
      status: 'failed',
      stage: 'evidence',
      last_error: message,
      completed_at: new Date().toISOString(),
      lease_expires_at: null
    });
  }

  async function renewLease(id, workerId, leaseMs = 30 * 60 * 1000) {
    if (!id) throw new Error('Audit job id is required.');
    const query = `/rest/v1/audit_jobs?id=eq.${encodeURIComponent(id)}&status=eq.scanning&worker_id=eq.${encodeURIComponent(String(workerId || ''))}`;
    const data = await request(query, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: {
        lease_expires_at: new Date(Date.now() + leaseMs).toISOString(),
        updated_at: new Date().toISOString()
      }
    });
    return Array.isArray(data) ? data[0] || null : data;
  }

  async function retryOrFail(job, error, maxAttempts = 4) {
    if (!job?.id) throw new Error('Audit job is required.');
    const message = String(error?.message || error || 'Audit worker failed').slice(0, 4000);

    if (Number(job.attempts || 0) < maxAttempts) {
      return update(job.id, {
        status: 'queued',
        stage: 'evidence',
        worker_id: null,
        last_error: message,
        completed_at: null,
        lease_expires_at: null
      });
    }

    return markFailed(job.id, error);
  }

  function registerPublicStatusRoute(app) {
    app.get('/audit-job-status/:publicToken', async (req, res) => {
      try {
        const row = await getPublic(req.params.publicToken);
        if (!row) return res.status(404).json({ error: 'Audit job not found.' });
        res.set('Cache-Control', 'no-store');
        return res.json(publicView(row));
      } catch (error) {
        console.error('Audit job status error:', error.message);
        return res.status(503).json({ error: 'Audit status is temporarily unavailable.' });
      }
    });
  }

  return {
    configured,
    enqueue,
    getPublic,
    publicView,
    claim,
    claimById,
    reserveLaunch,
    update,
    markReview,
    markPublished,
    markFailed,
    renewLease,
    retryOrFail,
    registerPublicStatusRoute
  };
}

module.exports = { createAuditJobStore };
