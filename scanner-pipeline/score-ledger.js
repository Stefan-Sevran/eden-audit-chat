function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function band(score) {
  if (score >= 95) return 'exceptional';
  if (score >= 90) return 'excellent';
  if (score >= 80) return 'strong';
  if (score >= 70) return 'good';
  if (score >= 60) return 'materially-improvable';
  if (score >= 40) return 'weak';
  return 'critical';
}

function ledger({ baseline = 100, deductions = [], credits = [], floor = 0, ceiling = 98 }) {
  const normalizedDeductions = deductions.filter(Boolean).map(x => ({ ...x, points: Math.max(0, Math.round(Number(x.points) || 0)) }));
  const normalizedCredits = credits.filter(Boolean).map(x => ({ ...x, points: Math.max(0, Math.round(Number(x.points) || 0)) }));
  const raw = baseline - normalizedDeductions.reduce((s,x)=>s+x.points,0) + normalizedCredits.reduce((s,x)=>s+x.points,0);
  const score = clamp(raw, floor, ceiling);
  return {
    baseline,
    deductions: normalizedDeductions,
    credits: normalizedCredits,
    rawScore: clamp(raw),
    score,
    band: band(score),
    ceilingApplied: score < raw || (raw > ceiling ? ceiling : null)
  };
}

module.exports = { clamp, band, ledger };
