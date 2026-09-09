function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function createAuditWorker({ auditJobStore, runEvidencePipeline, workerId = `audit-worker-${process.pid}`, logger = console } = {}) {
  if (!auditJobStore) throw new Error('auditJobStore is required.');
  if (typeof runEvidencePipeline !== 'function') throw new Error('runEvidencePipeline callback is required.');

  async function runOnce() {
    const job = await auditJobStore.claim(workerId);
    if (!job) return { claimed: false };
    let heartbeat = null;

    if (typeof auditJobStore.renewLease === 'function') {
      heartbeat = setInterval(() => {
        auditJobStore.renewLease(job.id, workerId).catch(error =>
          logger.error('Audit worker lease heartbeat failed:', job.id, error)
        );
      }, 5 * 60 * 1000);
      heartbeat.unref?.();
    }

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

      if (typeof auditJobStore.retryOrFail === 'function') {
        const row = await auditJobStore.retryOrFail(job, error, 4);
        const status =
          row?.status ||
          (Number(job.attempts || 0) < 4 ? 'queued' : 'failed');

        return { claimed: true, jobId: job.id, status, error };
      }

      await auditJobStore.markFailed(job.id, error);
      return { claimed: true, jobId: job.id, status: 'failed', error };

    } finally {
      if (heartbeat) clearInterval(heartbeat);
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
