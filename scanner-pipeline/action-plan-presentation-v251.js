const VERSION = '2.5.1';

function readinessFor(item = {}) {
  const effort = String(item.effort || '').toLowerCase();
  const action = String(item.action || '').toLowerCase();
  const title = String(item.title || '').toLowerCase();

  if (
    /ask|confirm|provide|clinic input|decision|approval/.test(action + ' ' + title)
  ) {
    return {
      id: 'needs-clinic-input',
      label: 'Needs clinic input',
      reason: 'The action depends on a clinic decision, missing detail or explicit approval.'
    };
  }

  if (
    effort === 'high' ||
    /integration|development|developer|technical|api|messenger|website rebuild|booking system/.test(action + ' ' + title)
  ) {
    return {
      id: 'needs-technical-implementation',
      label: 'Needs technical implementation',
      reason: 'The action likely requires technical configuration or implementation work.'
    };
  }

  return {
    id: 'ready-now',
    label: 'Ready now',
    reason: 'The action appears implementable without unresolved clinic input or heavy technical work.'
  };
}

function evidencePreviewFor(item = {}, manifest = {}) {
  const evidence = manifest.evidenceIntelligence?.evidence || [];
  const sourceId = item.sourceId || null;
  const sourcePillar = item.sourcePillar || null;

  const direct = evidence.find(x =>
    sourceId &&
    (x.id === sourceId ||
     x.sourceId === sourceId)
  );

  const fallback = direct || evidence.find(x =>
    sourcePillar && x.pillar === sourcePillar
  );

  if (!fallback) {
    return {
      status: 'unavailable',
      tier: item.confidence || 'unknown',
      title: 'Supporting evidence available in reviewer inspection',
      snippet: item.evidenceReason || '',
      sourceIds: [sourceId, sourcePillar].filter(Boolean)
    };
  }

  return {
    status: 'available',
    tier: fallback.tier || item.confidence || 'unknown',
    title: fallback.claim || fallback.title || item.title || 'Supporting evidence',
    snippet: fallback.reason || item.evidenceReason || '',
    value: fallback.value ?? null,
    sourceIds: [
      fallback.id,
      sourceId,
      ...(Array.isArray(fallback.sources) ? fallback.sources : [])
    ].filter(Boolean)
  };
}

function buildActionPlanPresentation(manifest = {}, actionPlan = {}) {
  const items = Array.isArray(actionPlan.items) ? actionPlan.items : [];

  const enriched = items.map(item => {
    const readiness = readinessFor(item);
    const evidencePreview = evidencePreviewFor(item, manifest);

    return {
      ...item,
      readiness,
      evidencePreview
    };
  });

  const quickWins = enriched
    .filter(x => x.readiness.id === 'ready-now' && x.impact === 'high')
    .slice(0, 2);

  return {
    schemaVersion: VERSION,
    items: enriched,
    quickWins: quickWins.map(x => ({
      id: x.id,
      title: x.title,
      action: x.action,
      timing: x.timing,
      confidence: x.confidence
    })),
    summary: {
      readyNow: enriched.filter(x => x.readiness.id === 'ready-now').length,
      needsClinicInput: enriched.filter(x => x.readiness.id === 'needs-clinic-input').length,
      needsTechnicalImplementation: enriched.filter(x => x.readiness.id === 'needs-technical-implementation').length
    }
  };
}

module.exports = {
  VERSION,
  readinessFor,
  evidencePreviewFor,
  buildActionPlanPresentation
};
