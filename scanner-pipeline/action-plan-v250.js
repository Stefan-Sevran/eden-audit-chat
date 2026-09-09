const VERSION = '2.5.0';

function safeText(value, max = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function defaultTiming(effort) {
  if (effort === 'low') return 'This week';
  if (effort === 'medium') return 'Next 30 days';
  if (effort === 'high') return 'Plan next phase';
  return 'Review next';
}

function normalizeActionPlanReview(value = {}, template = {}) {
  const allowed = new Map(
    (Array.isArray(template?.items) ? template.items : [])
      .filter(x => x && x.id)
      .map(x => [String(x.id), x])
  );

  const incoming = Array.isArray(value?.items) ? value.items : [];
  const byId = new Map(
    incoming
      .filter(x => x && x.id && allowed.has(String(x.id)))
      .map(x => [String(x.id), x])
  );

  return {
    items: [...allowed.entries()].map(([id, base]) => {
      const edit = byId.get(id) || {};
      return {
        id,
        include: edit.include !== false,
        title: safeText(edit.title, 240) || safeText(base.title, 240),
        action: safeText(edit.action, 1200) || safeText(base.action, 1200),
        owner: safeText(edit.owner, 120) || safeText(base.owner, 120) || 'Clinic team',
        timing: safeText(edit.timing, 120) || safeText(base.timing, 120) || defaultTiming(base.effort)
      };
    })
  };
}

function buildClinicActionPlan(manifest = {}, review = null) {
  const source = manifest.opportunityPrioritization || {};
  const machineItems = Array.isArray(source.opportunities)
    ? source.opportunities.filter(x => x && x.publishable !== false).slice(0, 3)
    : [];

  const defaults = machineItems.map((item, index) => ({
    id: String(item.id || `action-${index + 1}`),
    rank: Number(item.rank) || index + 1,
    include: true,
    title: safeText(item.title, 240) || `Priority ${index + 1}`,
    action: safeText(item.action, 1200),
    owner: 'Clinic team',
    timing: defaultTiming(item.effort),
    impact: item.impact || 'unknown',
    effort: item.effort || 'unknown',
    confidence: item.confidence || 'unknown',
    priorityScore: Number.isFinite(Number(item.priorityScore))
      ? Math.round(Number(item.priorityScore))
      : null,
    sourceId: item.sourceId || null,
    sourceKind: item.sourceKind || null,
    sourcePillar: item.sourcePillar || null,
    evidenceReason: safeText(item.evidenceReason, 1600)
  }));

  const normalizedReview = normalizeActionPlanReview(
    review?.actionPlan || {},
    { items: defaults }
  );
  const editById = new Map(normalizedReview.items.map(x => [x.id, x]));

  const items = defaults
    .map(base => {
      const edit = editById.get(base.id) || {};
      return {
        ...base,
        include: edit.include !== false,
        title: edit.title || base.title,
        action: edit.action || base.action,
        owner: edit.owner || base.owner,
        timing: edit.timing || base.timing
      };
    })
    .filter(x => x.include);

  return {
    schemaVersion: VERSION,
    publishable: items.length > 0,
    headline: '90-day action plan',
    intro:
      items.length > 0
        ? 'Start with the highest-impact, lowest-friction improvements first. Each action below is tied to evidence already reviewed in this Audit.'
        : 'No evidence-backed action-plan items are currently publishable.',
    items,
    reviewerOnly: {
      machineItemCount: defaults.length,
      includedItemCount: items.length,
      immutableSourceIds: defaults.map(x => x.sourceId).filter(Boolean),
      policy:
        'Reviewers may edit wording, owner and timing, or exclude a machine-generated item. They cannot create unsupported action-plan items here.'
    }
  };
}

module.exports = {
  VERSION,
  defaultTiming,
  normalizeActionPlanReview,
  buildClinicActionPlan
};
