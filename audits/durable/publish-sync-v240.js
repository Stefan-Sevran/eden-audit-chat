const fs = require('node:fs');
const path = require('node:path');
const { createAuditJobStore } = require('./audit-job-store-v240');

async function syncPublishedAuditJob({ outDir, reportUrl, report = null, logger = console }) {
  try {
    const metaPath = path.join(outDir, 'durable-job.json');
    if (!fs.existsSync(metaPath)) return { synced: false, reason: 'no-durable-job-metadata' };
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (!meta.jobId) return { synced: false, reason: 'missing-job-id' };
    const store = createAuditJobStore({supabaseUrl: process.env.SUPABASE_URL, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY});
    if (!store.configured) return { synced: false, reason: 'store-not-configured' };
    await store.markPublished(meta.jobId, {reportUrl, report});
    return { synced: true, jobId: meta.jobId };
  } catch (error) {
    logger.error('Published Audit job status sync failed:', error);
    return { synced: false, reason: String(error.message || error) };
  }
}
module.exports = { syncPublishedAuditJob };
