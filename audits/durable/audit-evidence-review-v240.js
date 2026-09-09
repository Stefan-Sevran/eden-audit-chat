const path = require('node:path');

function cleanBase(value) {
  return String(value || '').replace(/\/$/, '');
}

function encodeObjectPath(value) {
  return String(value || '')
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/');
}

function normalizeRelativePath(value) {
  const raw = String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');

  if (!raw || raw.length > 500) {
    throw new Error('A valid evidence path is required.');
  }

  const parts = raw.split('/');

  if (
    parts.some(
      part =>
        !part ||
        part === '.' ||
        part === '..'
    )
  ) {
    throw new Error('Invalid evidence path.');
  }

  return parts.join('/');
}

function createAuditEvidenceReview({
  supabaseUrl,
  serviceRoleKey,
  bucket = 'audit-evidence',
  expiresIn = 300,
  fetchImpl = global.fetch
} = {}) {
  const base = cleanBase(supabaseUrl);
  const key = String(serviceRoleKey || '');
  const configured =
    Boolean(base && key && typeof fetchImpl === 'function');

  async function request(url, options = {}) {
    if (!configured) {
      throw new Error(
        'Audit evidence review is not configured.'
      );
    }

    const response = await fetchImpl(url, {
      ...options,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    const text = await response.text();

    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!response.ok) {
      const message =
        data?.message ||
        data?.error ||
        `Supabase request failed: ${response.status}`;

      throw new Error(message);
    }

    return data;
  }

  async function getJob(jobId) {
    const id = encodeURIComponent(String(jobId || ''));

    if (!id) {
      throw new Error('Audit job id is required.');
    }

    const select = encodeURIComponent(
      'id,status,evidence_packet,internal_result'
    );

    const data = await request(
      `${base}/rest/v1/audit_jobs?id=eq.${id}&select=${select}&limit=1`
    );

    return Array.isArray(data)
      ? data[0] || null
      : null;
  }

  function durableEvidenceFor(job) {
    return (
      job?.internal_result?.durableEvidence ||
      job?.evidence_packet?.durableEvidence ||
      null
    );
  }

  async function signEvidence({
    jobId,
    relativePath
  } = {}) {
    const job = await getJob(jobId);

    if (!job) {
      const error = new Error('Audit job not found.');
      error.statusCode = 404;
      throw error;
    }

    const durable = durableEvidenceFor(job);

    if (!durable) {
      const error = new Error(
        'Durable evidence is not available for this Audit.'
      );
      error.statusCode = 409;
      throw error;
    }

    const expectedPrefix = String(job.id);
    const storedPrefix = String(
      durable.prefix || expectedPrefix
    );
    const storedBucket = String(
      durable.bucket || bucket
    );

    if (
      storedPrefix !== expectedPrefix ||
      storedBucket !== bucket
    ) {
      throw new Error(
        'Audit evidence manifest failed validation.'
      );
    }

    const safeRelative =
      normalizeRelativePath(relativePath);

    const objectPath =
      `${expectedPrefix}/${safeRelative}`;

    const data = await request(
      `${base}/storage/v1/object/sign/` +
      `${encodeURIComponent(bucket)}/` +
      `${encodeObjectPath(objectPath)}`,
      {
        method: 'POST',
        body: JSON.stringify({
          expiresIn
        })
      }
    );

    const rawSignedUrl =
      data?.signedURL ||
      data?.signedUrl ||
      null;

    if (!rawSignedUrl) {
      throw new Error(
        'Supabase did not return a signed evidence URL.'
      );
    }

    const signedUrl =
      /^https?:\/\//i.test(rawSignedUrl)
        ? rawSignedUrl
        : `${base}${rawSignedUrl}`;

    return {
      jobId: job.id,
      path: safeRelative,
      signedUrl,
      expiresIn
    };
  }

  function registerReviewRoutes(
    app,
    requireAdmin
  ) {
    if (typeof requireAdmin !== 'function') {
      throw new Error(
        'Audit evidence review requires admin middleware.'
      );
    }

    app.post(
      '/admin/audit-evidence/sign',
      requireAdmin,
      async (req, res) => {
        try {
          const result = await signEvidence({
            jobId: req.body?.jobId,
            relativePath: req.body?.path
          });

          res.set('Cache-Control', 'no-store');

          return res.json({
            ok: true,
            ...result
          });
        } catch (error) {
          console.error(
            'Audit evidence signing error:',
            error.message
          );

          return res
            .status(error.statusCode || 400)
            .json({
              error: error.message
            });
        }
      }
    );
  }

  return {
    configured,
    bucket,
    expiresIn,
    getJob,
    signEvidence,
    registerReviewRoutes
  };
}

module.exports = {
  createAuditEvidenceReview,
  normalizeRelativePath
};
