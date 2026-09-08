# Eden Clinic Audit V2.4.0 — merged backend

This package merges the full V2.3.2 production server base, V2.3.2f Mia intake, the Supabase durable Audit queue, the V2.3.1 evidence scanner, and publication-status synchronization.

Lifecycle: confirmed intake → queued → scanning → review → human approval → published private magic link.

## 1. Supabase
Run `supabase/audit-jobs-v240.sql` once in the Supabase SQL editor.

## 2. Render web service
Deploy this folder as the existing `eden-audit-chat` web service. Build command: `npm install && npx playwright install chromium`. Start command: `npm start`. Keep the existing environment variables, especially `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, Audit Telegram and Google Sheets settings.

## 3. Render background worker
Create a Background Worker from the same repository/build. Start command: `npm run start:audit-worker`. Use the same Supabase/OpenAI environment values. Set `EDEN_AUDIT_OUTPUT_ROOT` to a persistent-disk path if Review Studio must open the generated files after worker restarts.

## 4. Frontend
Clinicnet V44 already understands `auditJob.publicToken` and polls `/audit-job-status/:publicToken`. No additional V44 change is required.

## 5. Human review / publication
The scanner stops at `review`. Running `node scanner-pipeline/review-owner-report.js <path-to-snapshot.json>` preserves the existing human approval gate. After the private link is created, V2.4 syncs that URL back to the durable job as `published`.

## Safety / durability
- Intake is still sent to existing Sheets/Telegram handoffs.
- The durable queue is server-side only; no service-role key is sent to the browser.
- The public status route exposes only token/status/stage/report URL/update time.
- A 30-minute worker lease allows abandoned `scanning` jobs to be reclaimed, up to four attempts.
- Publication still requires the existing human approval checkbox.
