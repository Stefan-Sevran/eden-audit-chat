const VERSION = '2.4.9';

const IMPACT_WEIGHT = {
  high: 3,
  medium: 2,
  low: 1
};

const EFFORT_WEIGHT = {
  low: 3,
  medium: 2,
  high: 1
};

const CONFIDENCE_WEIGHT = {
  verified: 3,
  supported: 2,
  probable: 1,
  unknown: 0
};

function clamp100(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function priorityScore({ impact, effort, confidence }) {
  const i = IMPACT_WEIGHT[impact] || 0;
  const e = EFFORT_WEIGHT[effort] || 0;
  const c = CONFIDENCE_WEIGHT[confidence] || 0;
  if (!i || !e || !c) return null;

  // 45% commercial relevance heuristic, 30% ease, 25% evidence confidence.
  return clamp100(((i / 3) * 45) + ((e / 3) * 30) + ((c / 3) * 25));
}

function classifyOpportunity(candidate = {}) {
  const id = String(candidate.id || '');
  const pillar = String(candidate.pillar || '');
  const title = String(candidate.title || candidate.claim || candidate.reason || '');

  if (
    /google.*website|aggregator|directory/i.test(id + ' ' + title) &&
    /google|aggregator|directory/i.test(id + ' ' + title)
  ) {
    return {
      type: 'google-destination',
      title: 'Fix Google patient destination',
      impact: 'high',
      effort: 'low',
      action:
        'Point the Google Business Profile website action to the strongest clinic-owned landing page or booking entry point.'
    };
  }

  if (/facebook.*website|facebook.*booking|facebook.*phone/i.test(id + ' ' + title)) {
    return {
      type: 'facebook-continuity',
      title: 'Align Facebook patient actions',
      impact: 'medium',
      effort: 'low',
      action:
        'Align Facebook website, booking and contact actions with the clinic’s current patient journey.'
    };
  }

  if (/booking|journey|friction|manual confirmation|captcha|payment/i.test(id + ' ' + pillar + ' ' + title)) {
    return {
      type: 'booking-friction',
      title: 'Reduce booking journey friction',
      impact: 'high',
      effort: 'medium',
      action:
        'Simplify the observed booking handoff and remove unnecessary friction before the patient reaches the final booking action.'
    };
  }

  if (/phone|contact/i.test(id + ' ' + title)) {
    return {
      type: 'contact-consistency',
      title: 'Standardize patient contact details',
      impact: 'medium',
      effort: 'low',
      action:
        'Standardize the clinic’s patient-facing phone and contact details across public channels.'
    };
  }

  if (/control|external-third-party|social-platform/i.test(id + ' ' + pillar + ' ' + title)) {
    return {
      type: 'destination-control',
      title: 'Increase clinic control of the patient path',
      impact: 'high',
      effort: 'medium',
      action:
        'Move the highest-intent patient entry points toward clinic-controlled or purpose-built conversion destinations.'
    };
  }

  if (/continuity|mismatch|destination/i.test(id + ' ' + pillar + ' ' + title)) {
    return {
      type: 'cross-channel-continuity',
      title: 'Repair cross-channel patient continuity',
      impact: 'high',
      effort: 'medium',
      action:
        'Make Google, Facebook, website and booking destinations point into one consistent patient journey.'
    };
  }

  return {
    type: 'general-conversion',
    title: title || 'Improve the patient conversion path',
    impact: 'medium',
    effort: 'medium',
    action:
      'Review the verified weakness and remove the highest-friction step in the patient journey.'
  };
}

function dedupeByType(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item?.type || seen.has(item.type)) continue;
    seen.add(item.type);
    out.push(item);
  }
  return out;
}

function buildOpportunityPrioritization(manifest = {}) {
  const intelligence = manifest.evidenceIntelligence || {};
  const patientPath = manifest.patientPathQuality || {};
  const narrative = manifest.ownerPatientPathNarrative || {};

  const evidence = Array.isArray(intelligence.evidence)
    ? intelligence.evidence
    : [];
  const contradictions = Array.isArray(intelligence.contradictions)
    ? intelligence.contradictions
    : [];

  const candidates = [];

  // Blocking or high-severity contradictions are the strongest candidates,
  // but unresolved blockers do not become clinic-facing recommendations.
  for (const item of contradictions) {
    const confidence =
      item.blocksPublication === true ? 'verified' :
      item.severity === 'high' ? 'supported' :
      'supported';

    candidates.push({
      sourceKind: 'contradiction',
      id: item.id,
      pillar: item.pillar,
      title: item.title,
      reason: item.reason,
      severity: item.severity,
      blocksPublication: item.blocksPublication === true,
      confidence
    });
  }

  // Evidence items that directly describe a negative/misaligned state.
  for (const item of evidence) {
    const negativeBoolean = item.value === false;
    const text = `${item.id || ''} ${item.claim || ''} ${item.reason || ''}`;

    const weaknessText =
      /mismatch|aggregator|directory|external|weakest|friction|does not|different|manual confirmation|captcha/i.test(text);

    if (item.publishable === true && (negativeBoolean || weaknessText)) {
      candidates.push({
        sourceKind: 'evidence',
        id: item.id,
        pillar: item.pillar,
        title: item.claim,
        reason: item.reason,
        blocksPublication: false,
        confidence: item.tier || 'unknown'
      });
    }
  }

  // Ensure the main diagnosed weakness can produce a recommendation even
  // when no individual evidence item maps cleanly.
  if (patientPath.mainWeakness?.type && patientPath.mainWeakness.type !== 'unknown') {
    candidates.push({
      sourceKind: 'patient-path',
      id: `patient-path-${patientPath.mainWeakness.type}`,
      pillar: 'patient-path-quality',
      title: patientPath.mainWeakness.title,
      reason: patientPath.mainWeakness.reason,
      blocksPublication: false,
      confidence: patientPath.confidence || 'unknown'
    });
  }

  const unresolvedBlockingIds = new Set(
    (patientPath.blockingContradictions || [])
      .map(x => x.id)
      .filter(Boolean)
  );

  const mapped = candidates
    .map(candidate => {
      const classified = classifyOpportunity(candidate);
      const withheld =
        candidate.blocksPublication === true ||
        unresolvedBlockingIds.has(candidate.id);

      const score = priorityScore({
        impact: classified.impact,
        effort: classified.effort,
        confidence: candidate.confidence
      });

      return {
        id: `opportunity-${candidate.id || classified.type}`,
        sourceId: candidate.id || null,
        sourceKind: candidate.sourceKind,
        sourcePillar: candidate.pillar || null,
        type: classified.type,
        title: classified.title,
        impact: classified.impact,
        effort: classified.effort,
        confidence: candidate.confidence,
        priorityScore: score,
        action: classified.action,
        evidenceReason: candidate.reason || candidate.title || '',
        publishable: !withheld && candidate.confidence !== 'unknown',
        withheldReason: withheld
          ? 'Withheld until the underlying blocking evidence conflict is resolved.'
          : null
      };
    })
    .filter(x => x.priorityScore !== null)
    .sort((a, b) => b.priorityScore - a.priorityScore);

  const deduped = dedupeByType(mapped);

  const publishableItems = deduped
    .filter(x => x.publishable)
    .slice(0, 5)
    .map((item, index) => ({
      ...item,
      rank: index + 1
    }));

  const withheldItems = deduped.filter(x => !x.publishable);

  const topThree = publishableItems.slice(0, 3);

  const clinicFacing =
    publishableItems.length
      ? {
          headline: 'Highest-priority opportunities',
          summary:
            topThree.length === 1
              ? 'The Audit identified one evidence-backed improvement that should be addressed first.'
              : `The Audit identified ${topThree.length} evidence-backed improvements to prioritize first.`,
          priorities: topThree.map(item => ({
            rank: item.rank,
            title: item.title,
            impact: item.impact,
            effort: item.effort,
            confidence: item.confidence,
            action: item.action
          }))
        }
      : null;

  return {
    schemaVersion: VERSION,
    generatedAt: new Date().toISOString(),
    methodology: {
      note:
        'Priority ordering is a deterministic heuristic, not a forecast of revenue or ROI.',
      impact:
        'Impact is estimated from where the weakness sits in the patient conversion path.',
      effort:
        'Effort is a coarse implementation heuristic, not a project quote.',
      confidence:
        'Evidence confidence comes from the Audit evidence-intelligence layer.',
      formula:
        '45% impact + 30% ease + 25% evidence confidence'
    },
    publishable: publishableItems.length > 0,
    clinicFacing,
    opportunities: publishableItems,
    reviewerOnly: {
      withheldOpportunities: withheldItems,
      candidateCount: candidates.length,
      publishableCount: publishableItems.length,
      withheldCount: withheldItems.length,
      ownerNarrativeReady: narrative.publishable === true
    }
  };
}

module.exports = {
  VERSION,
  priorityScore,
  classifyOpportunity,
  buildOpportunityPrioritization
};
