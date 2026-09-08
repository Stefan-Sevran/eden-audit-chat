function uniqueLinks(items = []) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const href = typeof item === 'string' ? item : item?.href;
    if (!href || seen.has(href)) continue;
    seen.add(href);
    out.push(href);
  }
  return out;
}

function buildChannelModulePlan({ desktop = {}, mobile = {}, summary = {}, digitalFrontDoor = null } = {}) {
  const dF = desktop.funnelMetrics || {};
  const mF = mobile.funnelMetrics || {};
  const dC = desktop.channelMetrics || {};
  const mC = mobile.channelMetrics || {};

  const facebookUrls = uniqueLinks([...(dC.facebookLinks || []), ...(mC.facebookLinks || [])]);
  const mapsUrls = uniqueLinks([...(dF.mapsLinks || []), ...(mF.mapsLinks || [])]);
  const lineUrls = uniqueLinks([...(dF.lineLinks || []), ...(mF.lineLinks || [])]);
  const whatsappUrls = uniqueLinks([...(dC.whatsappDirectLinks || []), ...(mC.whatsappDirectLinks || [])]);
  const viberUrls = uniqueLinks([...(dC.viberLinks || []), ...(mC.viberLinks || [])]);

  const modules = [];
  if (summary.socialPresence?.facebook || summary.channelHandoff?.facebook || facebookUrls.length) {
    modules.push({
      id: 'facebook-page',
      detected: true,
      priority: summary.channelHandoff?.facebook ? 'high' : 'medium',
      reason: summary.channelHandoff?.facebook
        ? 'Facebook is part of the primary patient conversion path; inspect the handoff before judging end-to-end conversion readiness.'
        : 'Facebook presence was detected and can add channel-level trust, responsiveness and conversion evidence.',
      urls: facebookUrls.slice(0, 6),
      execution: 'separate-channel-module',
      affectsCoreWebsiteRuntime: false
    });
  }
  if (summary.googleMapsVisible || mapsUrls.length) {
    modules.push({
      id: 'google-business-profile',
      detected: true,
      priority: 'high',
      reason: 'Google Maps/Business presence was detected; reviews, rating, recency, profile completeness and action paths should be assessed separately.',
      urls: mapsUrls.slice(0, 6),
      execution: 'separate-channel-module',
      affectsCoreWebsiteRuntime: false
    });
  }
  if (summary.lineVisible || lineUrls.length) {
    modules.push({ id:'line', detected:true, priority:'medium', reason:'LINE patient-contact evidence was detected.', urls:lineUrls.slice(0,6), execution:'light-channel-evidence', affectsCoreWebsiteRuntime:false });
  }
  if (summary.whatsappPatientContactVisible || whatsappUrls.length) {
    modules.push({ id:'whatsapp', detected:true, priority:'medium', reason:'Direct WhatsApp patient-contact evidence was detected.', urls:whatsappUrls.slice(0,6), execution:'light-channel-evidence', affectsCoreWebsiteRuntime:false });
  }
  if (summary.viberVisible || viberUrls.length) {
    modules.push({ id:'viber', detected:true, priority:'medium', reason:'Direct Viber patient-contact evidence was detected.', urls:viberUrls.slice(0,6), execution:'light-channel-evidence', affectsCoreWebsiteRuntime:false });
  }

  const socialFirst = digitalFrontDoor && digitalFrontDoor.conventionalWebsite === false;
  return {
    architecture: socialFirst ? 'front-door-aware-channel-routing' : 'website-first-then-parallel-channel-modules',
    digitalFrontDoor: digitalFrontDoor || null,
    coreWebsiteScanUnchanged: !socialFirst,
    modules,
    recommendedNextModules: modules.filter(m => ['facebook-page','google-business-profile'].includes(m.id)).map(m => m.id),
    note: socialFirst ? 'The audit is front-door aware: Facebook/social/aggregator primary properties are assessed as channel surfaces rather than scored as clinic websites.' : 'Channel modules are intentionally separated from the core website crawl so richer Facebook/Google Business analysis can run independently or in parallel without making every website scan slower.'
  };
}

module.exports = { buildChannelModulePlan };
