const fs = require('node:fs');
const path = require('node:path');
const { createAuditJobStore } = require('./audits/durable/audit-job-store-v240');
const { createAuditWorker } = require('./audits/durable/audit-worker-v240');
const { runSnapshotAudit } = require('./scanner-pipeline/snapshot');

const store = createAuditJobStore({
  supabaseUrl: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
});
if (!store.configured) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the Audit worker.');

function publicPageFromIntake(intake) {
  return intake?.clinic?.websiteUrl || intake?.clinic?.website || intake?.fields?.websiteUrl || intake?.fields?.website || null;
}
function clinicNameFromIntake(intake) {
  return intake?.clinic?.clinicName || intake?.fields?.clinicName || null;
}
function clinicLocationFromIntake(intake) {
  return intake?.clinic?.clinicLocation || intake?.fields?.clinicLocation || null;
}
function revenueInputsFromIntake(intake) {
  return intake?.revenueInputs || intake?.answers || null;
}

async function runEvidencePipeline({ jobId, sessionId, intake, delivery }) {
  const pageUrl = publicPageFromIntake(intake);
  if (!pageUrl) throw new Error('Confirmed Audit intake has no public clinic page URL.');
  const root = process.env.EDEN_AUDIT_OUTPUT_ROOT || path.resolve(process.cwd(), 'audit-output', 'jobs');
  const outputDir = path.join(root, String(jobId));
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'durable-job.json'), JSON.stringify({jobId, sessionId, delivery}, null, 2));
  const manifest = await runSnapshotAudit(pageUrl, {
    outputDir,
    clinicName: clinicNameFromIntake(intake),
    clinicLocation: clinicLocationFromIntake(intake),
    revenueInputs: revenueInputsFromIntake(intake),
    aiEnabled: process.env.EDEN_AUDIT_AI_ENABLED !== 'false',
    headless: true,
    onProgress: msg => console.log(`[audit ${jobId}] ${msg}`)
  });
  return {
    evidencePacket: {
      outputDir: manifest.outputDir,
      reviewedUrl: manifest.reviewedUrl,
      finalUrl: manifest.finalUrl,
      clinicIdentity: manifest.clinicIdentity || null,
      unifiedEvidenceSummary: manifest.unifiedEvidenceSummary || null,
      crossChannelIntegrity: manifest.crossChannelIntegrity || null,
      publicationGuardrails: manifest.publicationGuardrails || null,
      ownerReport: manifest.ownerReport || null
    },
    internal: { outputDir: manifest.outputDir, snapshotPath: path.join(manifest.outputDir, 'snapshot.json') }
  };
}

const worker = createAuditWorker({ auditJobStore: store, runEvidencePipeline });
worker.loop({ idleMs: Number(process.env.EDEN_AUDIT_WORKER_IDLE_MS || 5000) });
