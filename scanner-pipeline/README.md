# Eden Clinic Audit Snapshot Engine V1.4

Run from the project `1` folder:

```bash
npm install
node scanners/snapshot.js https://clinicwebsite.com
```

V1.4 turns the scanner into a journey-aware, explainable multi-page clinic Audit.

## What V1.4 adds

- Lightweight site discovery across internal pages.
- Commercial page classification and ranking.
- Deep desktop/mobile inspection of up to 8 high-value patient pages by default (homepage, booking, contact/location, pricing/offers, results/before-after, team/about, and major services where available).
- Explainable hero scorecards: headline readability, body-copy readability, CTA prominence, background interference, text density, breathing room, and first-visit obstruction.
- Clear channel taxonomy:
  - patient communication: phone, LINE, WhatsApp, Messenger, email
  - discovery/social: Facebook, Instagram, YouTube, TikTok
  - location/navigation: Google Maps
  - conversion: online booking plus conversation-capable channels
- Channel accessibility signals: available, above-fold, persistent, direct-conversation, booking-capable.
- Safe multi-step booking inspection using synthetic test data. The walker can fill visible fields and click only explicit Next/Continue controls. It stops before final confirmation/submission.
- All POST/PUT/PATCH/DELETE requests are blocked during booking traversal to prevent the scanner from creating or modifying real bookings.
- Explainable booking scorecard with sub-scores for entry access, progress visibility, information burden, step burden, date/time access, confirmation immediacy, near-term availability, response immediacy, and account/payment friction.
- Evidence confidence in automated findings: verified, strong-inference, probable.

## Core output

Each clinic gets a folder under `audit-output/<hostname>/` containing screenshots plus JSON evidence:

- `snapshot.json`
- `page-metrics.json`
- `cta-metrics.json`
- `image-metrics.json`
- `funnel-metrics.json`
- `hero-metrics.json`
- `overlay-metrics.json`
- `channel-metrics.json`
- `cta-competition.json`
- `trust-metrics.json`
- `booking-flow.json`
- `conversion-score.json`
- `explainable-scorecard.json`
- `site-discovery.json`
- `page-journey.json`
- `automated-findings.json`
- `audit-findings.json`
- `pages/<page>/desktop.png`
- `pages/<page>/mobile.png`

If a hero video is detected, representative frames are captured. If first-visit cookie consent can be safely dismissed, a post-consent hero is also captured.

## Reliability

Navigation is retried automatically for the primary snapshots. Site discovery and deep-page inspection tolerate individual page failures rather than aborting the entire Audit.

## V1.5 — calibration discipline

V1.5 treats 95–100 as exceptional territory rather than a routine reward for passing deterministic checks. CTA and booking scores now expose deduction/credit ledgers, score bands, and measurement completeness. Unknown later-step form burden is not scored as verified evidence until the safe booking walker has actually observed it.

Score bands:
- 95–100 exceptional / near benchmark-level
- 90–94 excellent
- 80–89 strong
- 70–79 good but improvable
- 60–69 materially improvable
- 40–59 weak
- below 40 critical

99–100 should eventually require visual/semantic benchmark evidence (for example, multimodal review of message-to-CTA alignment) rather than DOM measurements alone.

## V1.6.3 calibration hygiene

V1.6.3 tightens benchmark calibration without expanding the audit scope:

- Appointment Access is capped at 96 so a visible booking route never implies a perfect appointment experience.
- Mobile UX now has an explainable component scorecard (responsive foundation, text legibility, tap targets, horizontal fit, primary-action usability, hero readability, first-visit obstruction, attention focus).
- Staleness is multi-signal: an old footer year alone is not enough. Obsolete technology, missing mobile viewport, legacy table layout and tiny fixed typography strengthen the signal; modern responsive/video evidence acts as a counter-signal.
- Displayed-phone extraction applies Thailand/Philippines plausibility filters to avoid treating registration-like numbers as phone channels.
- Credential/registration identifiers are collected only as labelled candidates for a future Trust Evidence module; they are not yet given trust-score credit.
- CLI runs now print coarse progress so a 2–3 minute deep scan does not look frozen.
- A hero validity score below 25 now caps Hero Clarity at 38 rather than 45, keeping fundamentally broken/legacy first impressions from receiving an overly generous score.


## V1.6.4 interaction weighting + credential evidence

V1.6.4 keeps the V1.6.3 calibration baseline and tightens two diagnostics:

- Mobile text legibility is capped at 98 for deterministic DOM-only evidence; perfect 100 is reserved for later visual validation.
- Tap-target quality is patient-impact weighted: booking/contact/form controls and above-fold interactions matter more than tiny footer/social links. Raw all-target percentages remain available diagnostically.
- Interaction diagnostics now split high-intent, form-control, navigation, secondary and above-fold targets.
- Credential/registration candidates use conservative label-first parsing and return label, kind, identifier, context and candidate confidence. They remain evidence only and do not add trust points yet.


## v1.6.5
- Distinguishes native booking, external booking providers, social-platform handoffs, and manual/contact-led appointment access.
- Prevents Facebook login forms from being scored as clinic booking journeys.
- Adds channelHandoff evidence.
- Reweights mobile tap-target quality toward high-intent patient actions.


## V1.7 calibration layer

V1.7 adds two report-facing pillar scorecards without changing the established overall-score formula:

- **Digital Experience**: mobile experience, hero experience, primary-action quality, technical freshness.
- **Patient Conversion Readiness**: primary action, contact access, appointment access, verified booking/handoff journey, surface friction.

Narrow capability checks such as responsive-foundation and horizontal-fit may legitimately return 100 when the tested defect is absent. This is not interpreted as a perfect website. Holistic scores reserve 100 for exceptional, comprehensively verified performance.

## v1.7.1 calibration + channel architecture
- Keeps the core website score formula unchanged from v1.7.0.
- Adds `assessmentProfile` to interpret the gap between Digital Experience and Patient Conversion Readiness.
- Adds `channel-module-plan.json` so Facebook and Google Business Profile can be audited in separate/parallel modules rather than slowing every core website scan.
- `100` remains allowed for narrow capability checks (e.g. no horizontal overflow detected); holistic scores remain effectively reserved below perfect unless evidence is exceptional.


## V1.7.2 Philippines calibration
- Adds Viber channel discovery and appointment/contact credit.
- Expands Philippine phone plausibility for Cebu/other area-code landlines and +63 formats.
- Booking fields are scoped to the most relevant visible booking form so chat widgets/auxiliary forms do not inflate field burden.
- Payment friction now requires evidence of a required payment/deposit interaction; general Payment & Insurance information is not penalized.
- Captcha and visible third-party advertising on the booking surface are measured separately as verified friction.
- Contact Access gives more credit to clear multi-channel access (contact page, WhatsApp, Messenger, Viber, email) while preserving headroom for instant/AI-assisted access.

## v1.8 — visual evidence reconciliation

The scanner now packages every relevant screenshot into `visual-evidence-manifest.json`, creates a structured `visual-review-template.json`, and writes `visual-reconciliation.json`. Hard browser facts stay authoritative; visual review can make bounded, confidence-weighted adjustments to perceptual categories such as hero clarity, CTA quality, mobile visual quality, trust presentation and booking-surface clutter.

See `VISUAL-REVIEW.md` for the schema and usage.

## v1.9.0 — Google Business evidence module (API-independent)

The core website scan remains unchanged. Every run now writes:

- `google-business-evidence-template.json` — strict null-first evidence schema
- `google-business-assessment.json` — separate GBP score (or awaiting evidence)
- `unified-evidence-summary.json` — website + visual + GBP status in one compact object

Google Business does **not** change the website overall score yet. This prevents cross-channel double counting until calibration is validated.

Optional evidence import:

```bash
node scanners/snapshot.js https://clinic.example \
  --clinic-name "Green Apple Dental" \
  --clinic-location "Cebu City, Philippines" \
  --gbp ./green-apple-gbp.json
```

Without `--gbp`, the scanner creates the evidence template and finishes normally. This keeps the system usable before a Google/Places API is connected.

## V2.0 Google Business branch evidence

V2.0 upgrades the GBP layer from a single-profile placeholder to a real multi-branch evidence model. Evidence remains provider/manual supplied for now; the scanner itself does not scrape Google Maps. Supply a JSON file with `--gbp` and each matched location is scored independently, then combined into a review-volume-aware portfolio score.

Example:

    node scanners/snapshot.js https://greenappledentalcebu.ph/ --clinic-name "Green Apple Dental" --clinic-location "Cebu City, Philippines" --gbp examples/green-apple-cebu-gbp.json

Unknown observations remain `null`; missing evidence is not treated as a failure. The output includes branch scores, evidence coverage, branch spread, and a portfolio interpretation. GBP remains separate from the website overall until cross-channel calibration is validated.

## V2.1 Facebook Patient Journey & Revenue Leakage
V2.1 adds a separate Facebook evidence layer. It does not scrape hidden/login-gated data and does not invent zeros when evidence is unavailable.

Outputs: `facebook-evidence-template.json`, `facebook-assessment.json`, `facebook-revenue-opportunity.json`, `cross-channel-integrity.json`.

Run with a target page seed only:
`node scanners/snapshot.js https://clinic.example --clinic-name "Clinic" --facebook-page-url https://www.facebook.com/ClinicPage`

Run with reviewed/provider evidence:
`node scanners/snapshot.js https://clinic.example --facebook ./facebook-evidence.json`

The module scores destination integrity, booking-button integrity, patient action access, cross-channel consistency and observable response performance. Revenue opportunity is shown only when high-intent lead counts and treatment-value assumptions are supplied.


## V2.1.1 — Facebook Probe
When a Facebook page URL is supplied directly or via `--facebook` evidence, the audit now performs a safe public-browser probe. It verifies destination integrity where observable, detects visible patient actions (Book/Message/WhatsApp/Call), follows an explicit booking-link href without submitting anything, records login walls as unknown rather than failure, captures `facebook-probe.png`, and writes `facebook-probe.json`. Visible comment DOM candidates may be collected, but response-time/revenue metrics stay unknown until timestamps and clinic replies are actually observable.

## V2.1.2 — Robust public Facebook action discovery

The Facebook probe now inspects multiple public browser states on desktop and mobile, waits for Facebook hydration, performs a modest scroll, and safely expands an obvious `More` action menu when available. Action discovery uses visible text, accessibility labels, link destinations, and common Messenger/WhatsApp/booking URL patterns.

Most importantly, `not-observed` is no longer treated as `false`. A public session that does not expose Book, Message, WhatsApp, or Call leaves those facts unknown and records confidence/status fields plus screenshots for visual reconciliation. Facebook overall scoring is withheld until at least 3 of 5 components have evidence.

New evidence includes `facebook-probe-desktop.png`, `facebook-probe-mobile.png`, per-state action counts, action status/confidence, and a `screenshotContradictionStatus` flag when no action is detected and visual review is recommended.


## V2.1.3 — Public Facebook demand & response evidence

The Facebook probe now discovers a bounded set of visible public post links and conservatively extracts comment elements Facebook explicitly exposes as comments/replies. It classifies visible patient intent (booking, pricing, availability, urgency, treatment), looks for observable clinic replies, and derives response coverage/latency when timestamps are available. Hidden/login-limited demand remains unknown. `demandLeakage` reports observed high-intent leads delayed beyond a configurable threshold (default 60 minutes) or unanswered. Revenue opportunity activates only when treatment-value assumptions are supplied.

## V2.1.4 — Authenticated Facebook observation mode

Public Facebook probing remains the default. When public evidence is incomplete, you can create a reusable local browser session without putting credentials in Eden code:

```bash
node scanners/facebook-login.js
```

A visible Chromium window opens. Log in to Facebook manually, then return to Terminal and press Enter. Eden saves `.eden-facebook-session.json` locally with restrictive file permissions.

Run an authenticated audit with:

```bash
node scanners/snapshot.js https://clinic.example \
  --facebook-page-url https://www.facebook.com/ClinicPage/ \
  --facebook-auth
```

Use a custom session path with `--facebook-session /path/to/session.json`. The session file contains browser authentication state and must be kept private. Delete it whenever you want to revoke local reuse. If authenticated mode is requested but the session file is missing, the scanner falls back to public mode and records that fact rather than fabricating evidence.

## V2.1.6 — authenticated Facebook post/comment extraction

- Uses saved Facebook storage state when `--facebook-auth` is supplied.
- Rejects generic Facebook tab URLs (for example `/reel/?s=tab`) as post evidence.
- Canonicalizes and deduplicates real post/reel/video/photo permalinks.
- Opens up to 5 recent observed content permalinks and safely expands visible comment/reply controls.
- Attempts to switch from relevance-filtered comments to `All comments` where the UI exposes it.
- Extracts visible comment author/text/time and clinic reply time where Facebook exposes structured evidence.
- Preserves `none-observed` / `login-limited` rather than treating hidden comments as zero demand.
- Improves Facebook page-name fallback so a generic document title of `Facebook` does not create a false brand mismatch.


## V2.1.7 — authenticated Facebook content-route discovery

V2.1.7 keeps public probing conservative, but authenticated mode now visits the Page's dedicated `/posts`, `/reels`, and `/photos` surfaces, performs 2–5 bounded scroll steps, canonicalizes observed content permalinks, then opens up to five content items for comment/reply extraction. It records per-route diagnostics and a lightweight last-activity label when Facebook exposes one.

Facebook score publication now has evidence-coverage ceilings: 3/5 known components can score at most 84, 4/5 at most 94, and only 5/5 evidence can reach 100. Unknown booking/response evidence therefore cannot create a misleading perfect channel score.

## V2.1.9 — Facebook-only clinic audit + comment-surface hardening

V2.1.9 adds a first-class `--facebook-only` mode for clinics whose Facebook Page is their primary digital storefront. In this mode the website and Google Business crawls are skipped entirely; the scanner runs the authenticated/public Facebook evidence collector directly and writes the Facebook evidence package under `audit-output/<facebook-page-slug>`.

Example:

```bash
node scanners/snapshot.js \
  --clinic-name "Yu Dental Center Davao" \
  --clinic-location "Davao City, Philippines" \
  --facebook-page-url "https://www.facebook.com/yudentalcenterdavao" \
  --facebook-auth \
  --facebook-only
```

The authenticated content collector also now attempts to open dedicated Facebook comment drawers/surfaces before expanding `View more comments` / replies, and includes a conservative `role=article` fallback when Facebook does not expose `aria-label="Comment by …"` nodes. New diagnostics include `commentSurfacesOpened` and `commentSurfaceLabels`. Unknown remains unknown; failure to expose comments is never treated as zero patient demand.


## V2.1.10 — reply expansion + Philippine patient-intent intelligence

V2.1.10 expands clinic reply threads after comments become visible and records reply-presence evidence even when Facebook does not expose an absolute timestamp. It broadens deterministic Philippines dental intent classification with Tagalog/Cebuano and shorthand terms (for example `pila`, `magkano`, `postiso`, `pustiso`, `asa`, `saan`, `location`, `near`, `bridge`, and `up and down`). Location and treatment inquiries are first-class patient-intent evidence. Response coverage can use verified reply-presence evidence; response speed remains unknown unless usable timestamps are exposed.


## V2.1.11 — parent-comment ↔ clinic-reply pairing

V2.1.11 hardens Facebook reply evidence. It clicks clinic-authored `replied · N replies` controls using DOM-side interaction when nested Facebook spans prevent Playwright text locators from reaching the clickable ancestor. It then associates visible clinic reply indicators to the correct patient comment using document geometry between consecutive comment articles, while still preferring explicit nested/sibling clinic reply articles when Facebook exposes them. Reply presence can therefore establish answered-vs-unanswered coverage even when reply text or an exact response timestamp remains hidden; response speed stays unknown until a usable timestamp is observed.


V2.1.12 adds rendered-order Facebook reply association. When Facebook mounts `Page replied · N replies` controls outside the patient-comment DOM subtree, the probe now pairs explicit reply labels to comments using the visible text stream between consecutive comment articles. Clinic-name matching is also normalized for common variants such as `Yu Dental Center Davao` vs `Yu Dental Davao`. Explicit Facebook reply labels can establish answered coverage even when reply-body or timestamp extraction remains unavailable; response speed stays unknown unless an actual reply timestamp is observed.


V2.1.13 adds a raw rendered-text reply association fallback for Facebook. When explicit `Clinic replied · N replies` labels are visible in the rendered post text but cannot be paired through Facebook's DOM hierarchy or geometry, the probe associates the label with the immediately preceding extracted patient comment in the same rendered stream. This may establish binary answered coverage, but reply text and response timing remain unknown unless separately observed. Diagnostics include `rawRenderedReplyAssociations`.


V2.1.14 hardens raw rendered-text reply association when Facebook pollutes the page title (for example `(7) Facebook`). It derives clinic aliases from the stable page handle and tolerates shortened reply labels such as `Yu Dental Davao` for a formal identity of `Yu Dental Center Davao`. The association still requires the explicit `Clinic replied · N reply/replies` label to appear between the current extracted comment anchor and the next extracted comment anchor.


V2.1.15 adds multi-state Facebook evidence accumulation. Canonical post permalinks are prioritized ahead of reels, each sampled post can be observed in initial, expanded, and reopened-expanded states, and the richest state is retained while comments/reply evidence are merged across states. Diagnostics now report renderAttempts, bestEvidenceState, bestEvidenceScore, evidenceVariability, retainedComments, retainedReplyAssociations, and an evidenceAccumulation summary. This prevents a transient weak Facebook render from being mistaken for verified absence.


V2.1.16 is a consolidation/calibration release. It keeps V2.1.15 multi-state evidence accumulation intact while correcting three semantics: answered comments with unknown reply timing remain timing-unknown rather than delayed; the public facebookProbe.response object is canonicalized from the same derived response metrics used by the assessment; and Facebook shell titles such as Notifications or (8) Facebook are rejected as page identities. Facebook component scoring also applies evidence-breadth ceilings to narrow action-access and cross-channel-consistency evidence, preventing a small set of positive observations from being presented as universally proven 100s while preserving unknown-as-unknown behavior.

## V2.2.1 — API validation + narrative intelligence

V2.2.1 keeps deterministic browser evidence and scores authoritative, then adds an independent OpenAI Responses API review of the website evidence and selected desktop/mobile viewport screenshots.

The API layer is deliberately bounded:
- it cannot rewrite scanner scores or hard browser facts;
- it returns `confirmed`, `contradicted`, `not_visually_assessable`, or `uncertain` for scanner-vs-snapshot comparisons;
- contradictions are surfaced for human review rather than silently reconciled;
- it generates structured client narrative: executive summary, what may be costing patients, top three priorities, quick wins, pillar explanations, caveats, and recommended Eden intervention;
- Google Business and Facebook narrative remains limited to their structured scanner evidence unless channel screenshots are explicitly added in a later version.

The generated evidence file is:

`audit-output/<clinic>/ai-audit-intelligence.json`

The client report consumes the AI narrative when the API review completes, while retaining the human verification gate.

### API setup

Create a local `.env` from `.env.example` and set `OPENAI_API_KEY`, or export the environment variable in your shell. `.env` is gitignored. Do not place keys in report JSON or command-line arguments.

The default model is `gpt-5.6-terra`; override it with `EDEN_OPENAI_MODEL` or `--openai-model`.

A normal website scan automatically runs the AI layer when `OPENAI_API_KEY` is available. Use `--no-ai` to disable it, or `--ai` to require an attempt.

To enrich a previously captured snapshot without rescanning:

```bash
node scanners/enrich-audit.js audit-output/<clinic>/snapshot.json
```

Then open:

`audit-output/<clinic>/report/index.html`
