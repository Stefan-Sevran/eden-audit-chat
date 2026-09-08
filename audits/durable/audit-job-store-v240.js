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
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: row
    });
    return Array.isArray(data) ? data[0] : data;
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
    update,
    markReview,
    markPublished,
    markFailed,
    registerPublicStatusRoute
  };
}

module.exports = { createAuditJobStore };
