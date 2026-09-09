const fs = require('node:fs');
const os = require('node:os');
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

function safeRelativePath(value) {
  const raw = String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');

  if (!raw || raw.length > 800) {
    throw new Error('Invalid review workspace path.');
  }

  const parts = raw.split('/');

  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error('Review workspace path traversal rejected.');
  }

  return parts.join('/');
}

function createAuditReviewWorkspace({
  supabaseUrl,
  serviceRoleKey,
  bucket = 'audit-evidence',
  rootDir =
    process.env.EDEN_AUDIT_REVIEW_ROOT ||
    path.join(os.tmpdir(), 'eden-audit-review'),
  fetchImpl = global.fetch
} = {}) {
  const base = cleanBase(supabaseUrl);
  const key = String(serviceRoleKey || '');
  const configured = Boolean(base && key && typeof fetchImpl === 'function');

  async function requestJson(url) {
    if (!configured) {
      throw new Error('Audit review workspace is not configured.');
    }

    const response = await fetchImpl(url, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Cache-Control': 'no-store'
      }
    });

    const text = await response.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {}

    if (!response.ok) {
      throw new Error(
        data?.message ||
        data?.error ||
        `Supabase request failed (${response.status}).`
      );
    }

    return data;
  }

  async function getJob(jobId) {
    const id = String(jobId || '');

    if (!id) {
      throw new Error('Audit job id is required.');
    }

    const select = encodeURIComponent(
      'id,public_token,status,stage,evidence_packet,internal_result'
    );

    const data = await requestJson(
      `${base}/rest/v1/audit_jobs` +
      `?id=eq.${encodeURIComponent(id)}` +
      `&select=${select}&limit=1`
    );

    return Array.isArray(data) ? data[0] || null : null;
  }

  function durableEvidence(job) {
    return (
      job?.internal_result?.durableEvidence ||
      job?.evidence_packet?.durableEvidence ||
      null
    );
  }

  async function downloadObject(objectPath) {
    const response = await fetchImpl(
      `${base}/storage/v1/object/authenticated/` +
      `${encodeURIComponent(bucket)}/` +
      `${encodeObjectPath(objectPath)}`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Cache-Control': 'no-store'
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        `Could not download Audit evidence object (${response.status}): ${objectPath}`
      );
    }

    return Buffer.from(await response.arrayBuffer());
  }

  async function hydrate(jobId) {
    const job = await getJob(jobId);

    if (!job) {
      throw new Error('Audit job not found.');
    }

    const durable = durableEvidence(job);

    if (!durable) {
      throw new Error('Durable evidence is not available for this Audit.');
    }

    const expectedPrefix = String(job.id);
    const storedPrefix = String(durable.prefix || expectedPrefix);
    const storedBucket = String(durable.bucket || bucket);

    if (storedPrefix !== expectedPrefix || storedBucket !== bucket) {
      throw new Error('Audit evidence metadata failed validation.');
    }

    const manifestPath = String(
      durable.manifestPath ||
      `${expectedPrefix}/storage-manifest.json`
    );

    if (manifestPath !== `${expectedPrefix}/storage-manifest.json`) {
      throw new Error('Audit evidence manifest path failed validation.');
    }

    const manifestBuffer = await downloadObject(manifestPath);

    let manifest;

    try {
      manifest = JSON.parse(manifestBuffer.toString('utf8'));
    } catch {
      throw new Error('Audit evidence manifest is invalid JSON.');
    }

    if (
      manifest?.bucket !== bucket ||
      manifest?.prefix !== expectedPrefix ||
      !Array.isArray(manifest?.files)
    ) {
      throw new Error('Audit evidence manifest contents failed validation.');
    }

    fs.mkdirSync(rootDir, { recursive: true });

    const workspaceDir = path.join(rootDir, expectedPrefix);

    fs.rmSync(workspaceDir, {
      recursive: true,
      force: true
    });

    fs.mkdirSync(workspaceDir, {
      recursive: true
    });

    for (const file of manifest.files) {
      const objectPath = String(file?.path || '');
      const prefix = `${expectedPrefix}/`;

      if (!objectPath.startsWith(prefix)) {
        throw new Error('Audit evidence object escaped its job prefix.');
      }

      const relative = safeRelativePath(objectPath.slice(prefix.length));
      const target = path.resolve(workspaceDir, relative);
      const workspaceResolved = path.resolve(workspaceDir);

      if (
        target !== workspaceResolved &&
        !target.startsWith(workspaceResolved + path.sep)
      ) {
        throw new Error('Review workspace path escaped its root.');
      }

      fs.mkdirSync(path.dirname(target), {
        recursive: true
      });

      fs.writeFileSync(
        target,
        await downloadObject(objectPath)
      );
    }

    const snapshotPath = path.join(workspaceDir, 'snapshot.json');

    if (!fs.existsSync(snapshotPath)) {
      throw new Error('Hydrated Audit does not contain snapshot.json.');
    }

    fs.writeFileSync(
      path.join(workspaceDir, 'durable-job.json'),
      JSON.stringify(
        {
          version: '2.4.0',
          jobId: job.id,
          publicToken: job.public_token || null,
          hydratedAt: new Date().toISOString()
        },
        null,
        2
      )
    );

    return {
      job,
      manifest,
      workspaceDir,
      snapshotPath
    };
  }

  return {
    configured,
    rootDir,
    getJob,
    hydrate
  };
}

module.exports = {
  createAuditReviewWorkspace,
  safeRelativePath
};
