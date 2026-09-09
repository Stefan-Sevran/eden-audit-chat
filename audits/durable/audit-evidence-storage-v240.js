const fs = require('node:fs');
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

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    '.json': 'application/json',
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf'
  })[ext] || 'application/octet-stream';
}

function walkFiles(root) {
  const out = [];
  function visit(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) visit(full);
      else if (stat.isFile()) out.push(full);
    }
  }
  visit(root);
  return out;
}

function createAuditEvidenceStorage({
  supabaseUrl,
  serviceRoleKey,
  bucket = 'audit-evidence',
  fetchImpl = global.fetch
} = {}) {
  const base = cleanBase(supabaseUrl);
  const key = String(serviceRoleKey || '');
  const configured = Boolean(base && key && typeof fetchImpl === 'function');

  async function uploadBuffer(objectPath, buffer, type = 'application/octet-stream') {
    if (!configured) throw new Error('Audit evidence storage is not configured.');

    const url =
      `${base}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`;

    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': type,
        'x-upsert': 'true',
        'Cache-Control': 'no-store'
      },
      body: buffer
    });

    const text = await response.text();

    if (!response.ok) {
      let message = text;
      try {
        const parsed = text ? JSON.parse(text) : null;
        message = parsed?.message || parsed?.error || text;
      } catch {}
      throw new Error(
        `Supabase Storage upload failed (${response.status}): ${message || 'unknown error'}`
      );
    }

    return {
      bucket,
      path: objectPath
    };
  }

  async function uploadFile(objectPath, filePath) {
    const stat = fs.statSync(filePath);
    const body = fs.readFileSync(filePath);

    await uploadBuffer(objectPath, body, contentType(filePath));

    return {
      bucket,
      path: objectPath,
      bytes: stat.size,
      contentType: contentType(filePath)
    };
  }

  async function uploadDirectory(jobId, rootDir) {
    if (!jobId) throw new Error('jobId is required.');
    if (!rootDir || !fs.existsSync(rootDir)) {
      throw new Error('Audit evidence directory does not exist.');
    }

    const prefix = String(jobId);
    const files = [];

    for (const full of walkFiles(rootDir)) {
      const relative = path.relative(rootDir, full).split(path.sep).join('/');
      const objectPath = `${prefix}/${relative}`;
      files.push(await uploadFile(objectPath, full));
    }

    const manifest = {
      version: '2.4.0',
      bucket,
      prefix,
      uploadedAt: new Date().toISOString(),
      fileCount: files.length,
      files
    };

    const manifestPath = `${prefix}/storage-manifest.json`;

    await uploadBuffer(
      manifestPath,
      Buffer.from(JSON.stringify(manifest, null, 2)),
      'application/json'
    );

    return {
      bucket,
      prefix,
      manifestPath,
      fileCount: files.length,
      files
    };
  }

  return {
    configured,
    bucket,
    uploadBuffer,
    uploadFile,
    uploadDirectory
  };
}

module.exports = { createAuditEvidenceStorage };
