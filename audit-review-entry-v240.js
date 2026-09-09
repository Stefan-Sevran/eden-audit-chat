const path = require('node:path');
const { spawn } = require('node:child_process');

const {
  createAuditReviewWorkspace
} = require('./audits/durable/review-workspace-v240');

const {
  createAuditEvidenceStorage
} = require('./audits/durable/audit-evidence-storage-v240');

async function main() {
  const jobId = String(process.argv[2] || '').trim();

  if (!jobId) {
    throw new Error('Usage: npm run review:audit -- <job-id>');
  }

  const workspace = createAuditReviewWorkspace({
    supabaseUrl: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    bucket: process.env.EDEN_AUDIT_EVIDENCE_BUCKET || 'audit-evidence'
  });

  if (!workspace.configured) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.'
    );
  }

  console.log(`Hydrating Audit review workspace: ${jobId}`);

  const hydrated = await workspace.hydrate(jobId);

  console.log(`Review workspace ready: ${hydrated.workspaceDir}`);

  const reviewScript = path.join(
    __dirname,
    'scanner-pipeline',
    'review-owner-report.js'
  );

  const child = spawn(
    process.execPath,
    [reviewScript, hydrated.snapshotPath],
    {
      stdio: 'inherit',
      env: process.env
    }
  );

  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code =>
      resolve(Number.isInteger(code) ? code : 1)
    );
  });

  console.log(
    'Review Studio closed. Syncing workspace back to private storage...'
  );

  const storage = createAuditEvidenceStorage({
    supabaseUrl: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    bucket: process.env.EDEN_AUDIT_EVIDENCE_BUCKET || 'audit-evidence'
  });

  await storage.uploadDirectory(jobId, hydrated.workspaceDir);

  console.log('Review workspace synced to Supabase Storage.');

  process.exitCode = exitCode;
}

main().catch(error => {
  console.error(
    `Audit Review Workspace failed: ${error.message || error}`
  );
  process.exit(1);
});
