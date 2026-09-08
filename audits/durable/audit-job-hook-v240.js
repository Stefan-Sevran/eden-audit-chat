function createConfirmedAuditJobHook({ auditJobStore, logger = console } = {}) {
  if (!auditJobStore) throw new Error('auditJobStore is required.');

  return async function enqueueConfirmedAudit({ sessionId, interview, delivery = null, source } = {}) {
    if (!interview || interview.status !== 'confirmed') {
      return null;
    }
    try {
      const job = await auditJobStore.enqueue({
        sessionId,
        intake: interview,
        delivery,
        source: source || 'mia-confirmed-intake'
      });
      return auditJobStore.publicView(job);
    } catch (error) {
      // Existing Telegram/Sheets handoff must remain successful even if the queue is temporarily unavailable.
      logger.error('Durable Audit job enqueue failed:', error.message);
      return null;
    }
  };
}

module.exports = { createConfirmedAuditJobHook };
