const fs = require('fs');
const path = require('path');
const { writeJson } = require('./utils');

const AI_AUDIT_VERSION = '2.2.28';
const DEFAULT_MODEL = process.env.EDEN_OPENAI_MODEL || 'gpt-5.6-terra';

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] != null) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[m[1]] = value;
  }
}
loadLocalEnv();

function compact(value, depth = 0) {
  if (depth > 7) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 30).map(v => compact(v, depth + 1));
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && value.length > 1400) return value.slice(0, 1399) + '…';
    return value;
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (/html|bodyText|raw|storageState|token|password/i.test(k)) continue;
    out[k] = compact(v, depth + 1);
  }
  return out;
}

function imageDataUrl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

function selectedAuditScreenshots(manifest) {
  const out = [];
  const add = (label, filePath, channel) => {
    if (!filePath || !fs.existsSync(filePath) || out.some(x => x.path === filePath)) return;
    out.push({ label, path: filePath, channel });
  };
  const conventionalWebsite = manifest.digitalFrontDoor?.conventionalWebsite !== false;
  if (conventionalWebsite) {
    add('desktop-first-visit', manifest.desktop?.screenshots?.hero, 'website');
    add('mobile-first-visit', manifest.mobile?.screenshots?.hero, 'website');
    add('desktop-post-consent', manifest.desktop?.screenshots?.postConsentHero, 'website');
    add('mobile-post-consent', manifest.mobile?.screenshots?.postConsentHero, 'website');
  }
  add('google-business-profile', manifest.googleBusinessProbe?.screenshot || manifest.googleBusiness?.evidence?.probe?.screenshot, 'googleBusiness');
  add('google-business-reviews', manifest.googleBusinessProbe?.reviewsSurface?.screenshot || manifest.googleBusiness?.evidence?.probe?.reviewsScreenshot, 'googleBusiness');
  add('google-business-destination', manifest.googleBusinessProbe?.conversionDestination?.screenshot || manifest.googleBusiness?.evidence?.branches?.[0]?.conversionDestination?.screenshot, 'googleBusiness');
  const fbAuth = manifest.facebookProbe?.authentication?.used === true || manifest.facebookProbe?.authentication?.status === 'authenticated-session';
  add(fbAuth ? 'facebook-authenticated-desktop' : 'facebook-public-desktop', manifest.facebookProbe?.screenshots?.desktop, 'facebook');
  add(fbAuth ? 'facebook-authenticated-mobile' : 'facebook-public-mobile', manifest.facebookProbe?.screenshots?.mobile, 'facebook');
  if (fbAuth) {
    const t=manifest.facebookProbe?.screenshots?.targeted||{};
    add('facebook-authenticated-header',t.header,'facebook');
    add('facebook-authenticated-about',t.about,'facebook');
    add('facebook-authenticated-reviews',t.reviews,'facebook');
    add('facebook-authenticated-posts',t.posts,'facebook');
  }
  const fbCommentShots = manifest.facebookProbe?.probeDiagnostics?.commentPostDiscovery?.commentScreenshots || [];
  add('facebook-comment-surface-1', fbCommentShots[0], 'facebook');
  add('facebook-comment-surface-2', fbCommentShots[1], 'facebook');
  // Keep the packet broad enough for cross-channel reconciliation, while limiting historic
  // Facebook render states to two representative comment surfaces to control image cost.
  return out.slice(0, 15);
}
const selectedWebsiteScreenshots = selectedAuditScreenshots;

function deterministicClaims(manifest) {
  const s = manifest.summary || {};
  const scoring = manifest.scoring || {};
  const categories = scoring.categories || {};
  const conventionalWebsite = manifest.digitalFrontDoor?.conventionalWebsite !== false;
  const claims = (conventionalWebsite ? [
    ['website-booking-cta-visible', 'Booking CTA is visible', s.bookingCtaVisible],
    ['website-booking-cta-desktop-above-fold', 'Booking CTA is above the fold on desktop', s.bookingCtaAboveFoldDesktop],
    ['website-booking-cta-mobile-above-fold', 'Booking CTA is above the fold on mobile', s.bookingCtaAboveFoldMobile],
    ['website-phone-actionable', 'Phone contact is actionable', s.phoneActionable],
    ['website-whatsapp-visible', 'WhatsApp is visibly available', s.whatsappVisible],
    ['website-messenger-visible', 'Messenger is visibly available', s.messengerVisible],
    ['website-google-maps-visible', 'Google Maps/location access is visible', s.googleMapsVisible],
    ['website-reviews-visible', 'Review/social-proof evidence is visible', s.reviewsVisible],
    ['website-doctor-profile-visible', 'Doctor/clinician profile evidence is visible', s.doctorProfileVisible],
    ['website-before-after-visible', 'Before/after evidence is visible', s.beforeAfterVisible],
    ['website-pricing-visible', 'Pricing information is visible', s.pricingVisible],
    ['website-cookie-overlay', 'A first-visit cookie/consent overlay is present', s.firstVisitCookieConsentDetected]
  ] : []).filter(([, , value]) => value !== null && value !== undefined)
    .map(([id, statement, value]) => ({ id, statement, scannerValue: !!value, evidenceClass: 'deterministic-browser-fact' }));

  const categoryClaims = (conventionalWebsite ? ['conversionCta', 'mobileUx', 'trustProof', 'heroClarity', 'lowFriction'] : [])
    .filter(k => Number.isFinite(Number(categories[k])))
    .map(k => ({
      id: `website-score-${k}`,
      statement: `${k} deterministic score`,
      scannerValue: Math.round(Number(categories[k])),
      evidenceClass: 'deterministic-score',
      validationInstruction: 'Do not independently rescore this number. Assess only whether the screenshots visually support, conflict with, or cannot assess the underlying direction.'
    }));
  const gp = manifest.googleBusinessProbe;
  const ga = manifest.googleBusiness?.assessment;
  const googleClaims = [];
  if (gp?.status === 'probed') {
    const add = (id, statement, value, evidenceClass='public-google-maps-browser-fact', validationInstruction='Use only the google-business-profile screenshot to visually confirm, contradict, or mark not assessable. Do not infer hidden profile data.') => {
      if (value === null || value === undefined) return;
      googleClaims.push({id,statement,scannerValue:value,evidenceClass,validationInstruction});
    };
    add('google-profile-name','Google Business profile name observed',gp.identity?.pageName);
    add('google-rating','Google Business rating observed',gp.profile?.rating);
    add('google-review-count','Google Business review count observed',gp.profile?.reviewCount);
    add('google-directions-action','Directions action is visibly available',gp.actions?.directions?.observed);
    add('google-website-action','Website action is visibly available',gp.actions?.website?.observed);
    add('google-call-action','Call action was observed by the browser probe',gp.actions?.call?.observed,'google-public-profile-browser-fact','A static screenshot may show a phone number while omitting or repositioning the Call control because Google Maps varies by viewport/state. Do not mark contradicted solely because a distinct Call button is outside the captured frame; use uncertain/not_visually_assessable unless the screenshot positively conflicts with the browser observation.');
    add('google-booking-action','Booking/appointment action is visibly available',gp.actions?.booking?.observed);
    add('google-message-action','Message/chat action is visibly available',gp.actions?.message?.observed);
    add('google-destination-classification','Google outbound destination classification',gp.conversionDestination?.classification,'google-outbound-destination-probe','Use the google-business-destination screenshot and final URL only. Confirm whether the destination type is visually consistent; do not invent downstream conversion performance.');
    add('google-destination-quality','Google outbound destination quality score',gp.conversionDestination?.qualityScore,'google-outbound-destination-probe','Do not independently rescore. Use the google-business-destination screenshot only to assess whether the destination-quality direction is broadly supported, contradicted, or not assessable.');
  }
  if (ga?.overall !== null && ga?.overall !== undefined && ga?.overall !== '' && Number.isFinite(Number(ga.overall))) googleClaims.push({id:'google-score-overall',statement:'Google Business deterministic score',scannerValue:Math.round(Number(ga.overall)),evidenceClass:'deterministic-score',validationInstruction:'Do not rescore. Assess only whether visible profile evidence broadly supports, conflicts with, or cannot assess the score direction.'});

  const fp = manifest.facebookProbe;
  const fbClaims = [];
  if (fp?.status === 'probed') {
    const addFb = (id, statement, value, instruction='Use only Facebook-labelled screenshots. Confirm what is visibly supported, contradicted, uncertain, or not assessable. Do not infer hidden comments, lifetime response behavior, or unavailable actions.') => {
      if (value === null || value === undefined || value === '') return;
      fbClaims.push({id, statement, scannerValue:value, evidenceClass:'sampled-public-facebook-browser-fact', validationInstruction:instruction});
    };
    addFb('facebook-profile-name','Facebook page/profile name observed',fp.page?.pageName);
    addFb('facebook-destination-clinic-page','Facebook destination lands on the clinic page',fp.destination?.landsOnClinicPage);
    addFb('facebook-wrong-page','Facebook destination is a wrong page',fp.destination?.wrongPage);
    addFb('facebook-generic-destination','Facebook destination is generic rather than clinic-specific',fp.destination?.genericFacebookDestination);
    addFb('facebook-brand-name-match','Facebook brand name matches the audited clinic',fp.consistency?.brandNameMatches);
    addFb('facebook-book-action-observation','Facebook Book action observation status',fp.actions?.bookButtonStatus);
    addFb('facebook-message-action-observation','Facebook Message action observation status',fp.actions?.messageButtonStatus);
    addFb('facebook-whatsapp-action-observation','Facebook WhatsApp action observation status',fp.actions?.whatsappButtonStatus);
    addFb('facebook-call-action-observation','Facebook Call action observation status',fp.actions?.callButtonStatus);
    const opened = fp.probeDiagnostics?.commentPostDiscovery?.commentSurfacesOpened;
    if (Number.isFinite(Number(opened))) addFb('facebook-comment-surfaces-opened','Facebook comment surfaces opened during sampled inspection',Number(opened),'Use Facebook comment-surface screenshots only. This is a sampled browser observation, not evidence of total page demand or complete comment history.');
    const observed = fp.response?.scoringObservedIntentComments ?? fp.demand?.patientIntentCommentCount;
    if (Number.isFinite(Number(observed)) && Number(observed) > 0) addFb('facebook-high-intent-comments-observed','Explicit/high-intent patient comments observed in sampled Facebook content',Number(observed),'Use only supplied Facebook comment screenshots. Validate visible sampled demand direction; never infer exhaustive history.');
  }
  return [...claims, ...categoryClaims, ...googleClaims, ...fbClaims];
}

function normalizeAutomatedFindings(findings) {
  if (Array.isArray(findings)) return findings;
  if (Array.isArray(findings?.findings)) return findings.findings;
  const buckets = ['opportunities', 'strengths', 'observations'];
  const merged = [];
  for (const key of buckets) {
    if (Array.isArray(findings?.[key])) merged.push(...findings[key]);
  }
  return merged;
}

function evidencePacket(manifest, reportModel) {
  const normalizedFindings = normalizeAutomatedFindings(manifest.findings);
  return {
    auditVersion: manifest.version,
    clinicIdentity: compact(manifest.clinicIdentity),
    reviewedUrl: manifest.reviewedUrl,
    scannerOverall: manifest.scoring?.overall ?? null,
    scannerCategories: compact(manifest.scoring?.categories || {}),
    scannerPillars: compact(manifest.scoring?.pillars || {}),
    summary: compact(manifest.summary || {}),
    explainability: compact(manifest.scoring?.explainability || {}),
    automatedFindings: compact(normalizedFindings.slice(0, 15)),
    bookingFlow: compact(manifest.bookingFlow || null),
    googleBusiness: compact(manifest.googleBusiness?.assessment || null),
    googleBusinessEvidence: compact(manifest.googleBusiness?.evidence || null),
    googleBusinessProbe: compact(manifest.googleBusinessProbe || null),
    facebook: compact(manifest.facebook?.assessment || null),
    facebookProbe: compact(manifest.facebookProbe || null),
    reportDraft: compact({ pillars: reportModel?.pillars, priorityFindings: reportModel?.priorityFindings, quickWins: reportModel?.quickWins }),
    claimsForVisualValidation: deterministicClaims(manifest)
  };
}

function responseSchema() {
  const str = { type: 'string' };
  const nullableStr = { anyOf: [{ type: 'string' }, { type: 'null' }] };
  return {
    type: 'object', additionalProperties: false,
    required: ['validation', 'conflicts', 'visualAssessments', 'googleBusinessVisualAssessments', 'facebookVisualAssessments', 'facebookSurfaceEvidence', 'narrative'],
    properties: {
      validation: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['claimId', 'status', 'confidence', 'rationale', 'evidenceScreenshots'],
          properties: {
            claimId: str,
            status: { type: 'string', enum: ['confirmed', 'contradicted', 'not_visually_assessable', 'uncertain'] },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            rationale: str,
            evidenceScreenshots: { type: 'array', items: str }
          }
        }
      },
      conflicts: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['claimId', 'scannerPosition', 'visualPosition', 'severity', 'humanReviewRequired'],
          properties: {
            claimId: str, scannerPosition: str, visualPosition: str,
            severity: { type: 'string', enum: ['low', 'medium', 'high'] },
            humanReviewRequired: { type: 'boolean' }
          }
        }
      },
      visualAssessments: {
        type: 'object', additionalProperties: false,
        required: ['heroClarity', 'primaryActionQuality', 'mobileVisualQuality', 'trustPresentation', 'perceivedFriction'],
        properties: Object.fromEntries(['heroClarity','primaryActionQuality','mobileVisualQuality','trustPresentation','perceivedFriction'].map(k => [k, {
          type: 'object', additionalProperties: false,
          required: ['assessment', 'confidence', 'rationale', 'evidenceScreenshots'],
          properties: {
            assessment: { type: 'string', enum: ['strong', 'adequate', 'weak', 'not_assessable'] },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            rationale: str,
            evidenceScreenshots: { type: 'array', items: str }
          }
        }]))
      },
      googleBusinessVisualAssessments: {
        type: 'object', additionalProperties: false,
        required: ['profileIdentity','reputationPresentation','actionAccess','bookingPath','visualTrust'],
        properties: Object.fromEntries(['profileIdentity','reputationPresentation','actionAccess','bookingPath','visualTrust'].map(k => [k, {
          type: 'object', additionalProperties: false,
          required: ['assessment','confidence','rationale','evidenceScreenshots'],
          properties: {
            assessment: { type: 'string', enum: ['strong','adequate','weak','not_assessable'] },
            confidence: { type: 'string', enum: ['high','medium','low'] },
            rationale: str,
            evidenceScreenshots: { type: 'array', items: str }
          }
        }]))
      },
      facebookVisualAssessments: {
        type: 'object', additionalProperties: false,
        required: ['profileIdentity','actionAccess','demandVisibility','responseEvidence','handoffQuality','receptionistOpportunity'],
        properties: {
          ...Object.fromEntries(['profileIdentity','actionAccess','demandVisibility','responseEvidence','handoffQuality'].map(k => [k, {
            type: 'object', additionalProperties: false,
            required: ['assessment','confidence','rationale','evidenceScreenshots'],
            properties: {
              assessment: { type: 'string', enum: ['strong','adequate','weak','not_assessable'] },
              confidence: { type: 'string', enum: ['high','medium','low'] },
              rationale: str,
              evidenceScreenshots: { type: 'array', items: str }
            }
          }])),
          receptionistOpportunity: {
            type: 'object', additionalProperties: false,
            required: ['opportunity','confidence','rationale','evidenceScreenshots'],
            properties: {
              opportunity: { type: 'string', enum: ['high','medium','low','not_assessable'] },
              confidence: { type: 'string', enum: ['high','medium','low'] },
              rationale: str,
              evidenceScreenshots: { type: 'array', items: str }
            }
          }
        }
      },
      facebookSurfaceEvidence: {
        type: 'object', additionalProperties: false,
        required: ['observationMode','pageName','followerCount','recommendationPercent','recommendationReviewCount','phone','address','messageActionVisible','callActionVisible','bookingActionVisible','latestVisibleActivityLabel','recentVisiblePostLabels','visiblePostCount','engagementSamples','contentPresentation','confidence','evidenceScreenshots'],
        properties: {
          observationMode: { type: 'string', enum: ['authenticated','public','mixed','not_assessable'] },
          pageName: nullableStr,
          followerCount: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          recommendationPercent: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          recommendationReviewCount: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          phone: nullableStr, address: nullableStr,
          messageActionVisible: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
          callActionVisible: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
          bookingActionVisible: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
          latestVisibleActivityLabel: nullableStr,
          recentVisiblePostLabels: { type: 'array', items: str, maxItems: 8 },
          visiblePostCount: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          engagementSamples: {
            type: 'array', maxItems: 6,
            items: { type: 'object', additionalProperties: false, required: ['label','reactionCount','commentCount','shareCount'], properties: {
              label: str,
              reactionCount: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
              commentCount: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
              shareCount: { anyOf: [{ type: 'integer' }, { type: 'null' }] }
            }}
          },
          contentPresentation: {
            type: 'object', additionalProperties: false,
            required: ['assessment','rationale'],
            properties: { assessment: { type: 'string', enum: ['clear','mixed','cluttered','not_assessable'] }, rationale: str }
          },
          confidence: { type: 'string', enum: ['high','medium','low'] },
          evidenceScreenshots: { type: 'array', items: str }
        }
      },
      narrative: {
        type: 'object', additionalProperties: false,
        required: ['executiveSummary', 'costingPatients', 'topPriorities', 'quickWins', 'pillarExplanations', 'caveats', 'edenIntervention'],
        properties: {
          executiveSummary: str,
          costingPatients: str,
          topPriorities: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['title','why','evidenceBasis'], properties: { title:str, why:str, evidenceBasis:str } } },
          quickWins: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['title','action','evidenceBasis'], properties: { title:str, action:str, evidenceBasis:str } } },
          pillarExplanations: {
            type: 'object', additionalProperties: false,
            required: ['website','googleBusiness','facebook'],
            properties: { website:str, googleBusiness:str, facebook:str }
          },
          caveats: { type: 'array', items: str },
          edenIntervention: str
        }
      }
    }
  };
}

function promptText(packet, screenshots) {
  return `You are the independent validation and interpretation layer for Eden Clinic Audit.

NON-NEGOTIABLE EVIDENCE RULES:
1. The deterministic scanner is authoritative for hard browser facts such as URLs, measured dimensions, field counts, booking steps, viewport overflow, and machine-observed links. You may flag a plausible contradiction, but NEVER silently overwrite these facts or any scanner score.
2. Screenshots are an independent second evidence channel for perceptual/visible questions: prominence, hierarchy, clutter, trust presentation, whether a visually obvious item appears to contradict a scanner claim, and first-impression friction.
3. Do NOT invent facts, counts, scores, response times, revenue estimates, patient behavior, or missing evidence.
4. If a screenshot cannot prove a claim, use not_visually_assessable or uncertain.
5. A contradiction must be explicit and sent to human review. Do not resolve it yourself.
6. Preserve channel caveats. Facebook is sampled unless the supplied evidence says exhaustive. Unknown means unknown, not zero.
7. Narrative language must be compelling but defensible. Every priority and quick win must cite its evidence basis in plain language.
8. Do not create a blended clinic score. Explain existing scanner scores only.
9. Website screenshots validate website claims. Google-labelled screenshots validate Google Business / Maps. Facebook-labelled screenshots validate Facebook only. Do not use one channel's screenshot to validate another channel.
10. For Google Business, distinguish directly observed public profile facts from inferences. Rating/review counts/actions may be visually validated when shown; review-response behavior, completeness, recency, or hidden attributes must remain not assessable unless the packet directly supplies them.
11. For Facebook, treat screenshots as sampled public evidence only. A screenshot may confirm visible page identity, visible action controls, visible patient comments, or visible reply evidence. It may NOT prove lifetime page history, overall response rate, response speed, or absence of hidden controls/comments.
12. Facebook scanner statuses such as "not-observed" mean exactly that: the browser did not observe the control in sampled states. They are NOT verified absence. If a Facebook screenshot visibly shows the control, mark the scanner claim contradicted and flag human review.
13. When assessing Facebook receptionistOpportunity, consider only evidenced conversion friction: visible high-intent questions, weak/unclear action access, social/login handoff friction, or visibly manual pathways. Do not estimate bookings or revenue. If the evidence is too thin, use not_assessable.
14. FACEBOOK AUTHENTICATED SURFACE EXTRACTION: Targeted labels facebook-authenticated-header/about/reviews/posts are higher-priority evidence than generic Facebook screenshots. Inspect those first.  when labels begin facebook-authenticated-, explicitly inspect those screenshots for visible page name, follower count, recommendation percentage/count, phone, address, visible Message/Call/Book actions, recent activity labels, visible posts, engagement counts, and content presentation. Return these only in facebookSurfaceEvidence. If text is not legible, return null rather than guessing.
15. Screenshot provenance is binding. Never describe an authenticated screenshot as a logged-out/public state. Never describe a public screenshot as authenticated. If only authenticated screenshots are supplied, do not recommend fixing a logged-out Facebook handoff based on those images.
16. facebookSurfaceEvidence numbers are visual observations, not DOM facts. They may fill high-value null gaps only when confidence is medium/high and must retain visual provenance. Do not overwrite a conflicting deterministic non-null value; flag a conflict instead.
17. For engagementSamples, record only clearly visible counts tied to a visible post. Do not extrapolate an engagement rate or infer that low visible engagement equals low business performance.

Screenshot labels available: ${screenshots.map(s => s.label).join(', ') || 'none'}.

AUDIT EVIDENCE PACKET:
${JSON.stringify(packet)}

Return the exact structured object requested by the schema.`;
}

function extractOutputText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  for (const item of data?.output || []) {
    for (const c of item?.content || []) if (c?.type === 'output_text' && typeof c.text === 'string') return c.text.trim();
  }
  return '';
}

async function callOpenAI({ apiKey, model = DEFAULT_MODEL, packet, screenshots, fetchImpl = global.fetch }) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
  if (typeof fetchImpl !== 'function') throw new Error('Global fetch is unavailable. Use Node 18+ or provide fetchImpl.');
  const content = [{ type: 'input_text', text: promptText(packet, screenshots) }];
  for (const shot of screenshots) {
    const data = imageDataUrl(shot.path);
    if (!data) continue;
    content.push({ type: 'input_text', text: `Screenshot evidence label: ${shot.label}` });
    content.push({ type: 'input_image', image_url: data });
  }
  const body = {
    model,
    reasoning: { effort: 'medium' },
    input: [{ role: 'user', content }],
    text: {
      format: {
        type: 'json_schema',
        name: 'eden_audit_validation',
        strict: true,
        schema: responseSchema()
      }
    }
  };
  const response = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`OpenAI API ${response.status}: ${data?.error?.message || 'request failed'}`);
  const text = extractOutputText(data);
  if (!text) throw new Error('OpenAI API returned no output_text');
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error('OpenAI API returned non-JSON output despite structured-output request'); }
  return { parsed, responseId: data.id || null, model: data.model || model, usage: data.usage || null };
}

function summarizeAgreement(result, claimCount) {
  const rows = result?.validation || [];
  const count = status => rows.filter(r => r.status === status).length;
  const conflicts = result?.conflicts || [];
  return {
    claimsSubmitted: claimCount,
    claimsReturned: rows.length,
    confirmed: count('confirmed'),
    contradicted: count('contradicted'),
    uncertain: count('uncertain'),
    notVisuallyAssessable: count('not_visually_assessable'),
    humanReviewConflicts: conflicts.filter(c => c.humanReviewRequired).length,
    status: conflicts.some(c => c.humanReviewRequired) ? 'human-review-required' : 'no-material-conflict-observed'
  };
}

async function runAuditIntelligence(manifest, reportModel, options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY || null;
  const effectiveModel = options.model || DEFAULT_MODEL;
  const enabled = options.enabled !== false && (!!options.force || !!apiKey);
  const screenshots = selectedAuditScreenshots(manifest);
  const packet = evidencePacket(manifest, reportModel);
  if (!enabled) {
    const envPath = path.resolve(process.cwd(), '.env');
    const reason = options.enabled === false ? 'AI validation explicitly disabled' : `OPENAI_API_KEY not configured in process environment or ${envPath}`;
    return { schemaVersion: AI_AUDIT_VERSION, status: 'not-run', reason, model: effectiveModel, apiKeyDetected:false, screenshots: screenshots.map(s => ({ label:s.label, path:s.path })), evidencePacket: packet };
  }
  try {
    const api = await callOpenAI({ apiKey, model: effectiveModel, packet, screenshots, fetchImpl: options.fetchImpl || global.fetch });
    return {
      schemaVersion: AI_AUDIT_VERSION,
      status: 'completed',
      model: api.model,
      apiKeyDetected:true,
      responseId: api.responseId,
      usage: api.usage,
      screenshots: screenshots.map(s => ({ label:s.label, path:s.path })),
      agreement: summarizeAgreement(api.parsed, packet.claimsForVisualValidation.length),
      ...api.parsed
    };
  } catch (error) {
    return { schemaVersion: AI_AUDIT_VERSION, status: 'failed', model: effectiveModel, apiKeyDetected:!!apiKey, error: String(error.message || error), screenshots: screenshots.map(s => ({ label:s.label, path:s.path })) };
  }
}

function writeAuditIntelligence(outDir, result) {
  writeJson(path.join(outDir, 'ai-audit-intelligence.json'), result);
  return path.join(outDir, 'ai-audit-intelligence.json');
}

module.exports = {
  AI_AUDIT_VERSION, DEFAULT_MODEL, deterministicClaims, selectedWebsiteScreenshots, selectedAuditScreenshots, normalizeAutomatedFindings, evidencePacket,
  responseSchema, extractOutputText, callOpenAI, runAuditIntelligence, writeAuditIntelligence, summarizeAgreement
};
