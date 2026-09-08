function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function createAuditWorker({ auditJobStore, runEvidencePipeline, workerId = `audit-worker-${process.pid}`, logger = console } = {}) {
  if (!auditJobStore) throw new Error('auditJobStore is required.');
  if (typeof runEvidencePipeline !== 'function') throw new Error('runEvidencePipeline callback is required.');

  async function runOnce() {
    const job = await auditJobStore.claim(workerId);
    if (!job) return { claimed: false };
    try {
      const result = await runEvidencePipeline({
        jobId: job.id,
        sessionId: job.session_id,
        intake: job.intake,
        delivery: job.delivery
      });
      await auditJobStore.markReview(job.id, {
        evidencePacket: result?.evidencePacket || result?.evidence || null,
        internal: result?.internal || result || null
      });
      return { claimed: true, jobId: job.id, status: 'review', result };
    } catch (error) {
      logger.error('Audit worker job failed:', job.id, error);
      await auditJobStore.markFailed(job.id, error);
      return { claimed: true, jobId: job.id, status: 'failed', error };
    }
  }

  async function loop({ idleMs = 5000, errorMs = 10000 } = {}) {
    logger.log('Eden Audit worker started:', workerId);
    for (;;) {
      try {
        const result = await runOnce();
        if (!result.claimed) await sleep(idleMs);
      } catch (error) {
        logger.error('Audit worker loop error:', error);
        await sleep(errorMs);
      }
    }
  }

  return { runOnce, loop };
}

module.exports = { createAuditWorker };
