# Eden Clinic Audit — Visual Evidence & Reconciliation (v1.8)

The deterministic browser scanner remains the source of truth for hard facts. Visual review is used only where screenshots provide better evidence than DOM heuristics.

## Files produced

- `visual-evidence-manifest.json` — screenshot inventory plus deterministic context.
- `visual-review-template.json` — schema for a human or vision model to fill in.
- `visual-reconciliation.json` — deterministic baseline or reconciled result when a visual review is supplied.

## Run without a visual review

```bash
node scanners/snapshot.js https://clinic.example
```

The audit produces the visual evidence package and reports `awaiting-visual-review`.

## Apply an existing visual review

```bash
node scanners/snapshot.js https://clinic.example /full/path/to/visual-review.json
```

The review can also be supplied through `EDEN_VISUAL_REVIEW=/path/review.json`.

## Guardrails

Browser evidence wins for verified fields, booking stages, URLs, payment/login requirements, responsive viewport, overflow, CTA geometry and contrast. Screenshot review is preferred for hierarchy, whitespace, clutter, visual trust, imagery, background interference and ad distraction.

Visual adjustments are confidence-weighted and bounded. Large disagreements are surfaced for review rather than silently accepted.
