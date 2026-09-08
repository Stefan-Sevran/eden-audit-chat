create extension if not exists pgcrypto;

create table if not exists public.audit_jobs (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique,
  public_token text not null unique,
  status text not null default 'queued' check (status in ('queued','scanning','review','published','failed')),
  stage text not null default 'evidence' check (stage in ('evidence','review','report')),
  intake jsonb not null,
  delivery jsonb,
  source text,
  evidence_packet jsonb,
  internal_result jsonb,
  report jsonb,
  report_url text,
  attempts integer not null default 0,
  worker_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  lease_expires_at timestamptz
);

create index if not exists audit_jobs_queue_idx on public.audit_jobs(status, created_at);
create index if not exists audit_jobs_public_token_idx on public.audit_jobs(public_token);

alter table public.audit_jobs enable row level security;
-- No public RLS policy is created. Server-side access uses SUPABASE_SERVICE_ROLE_KEY.

create or replace function public.claim_audit_job(p_worker_id text)
returns setof public.audit_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_id uuid;
begin
  select id into claimed_id
  from public.audit_jobs
  where status = 'queued'
     or (status = 'scanning' and lease_expires_at is not null and lease_expires_at < now() and attempts < 4)
  order by created_at asc
  for update skip locked
  limit 1;

  if claimed_id is null then
    return;
  end if;

  return query
  update public.audit_jobs
  set status='scanning',
      stage='evidence',
      worker_id=p_worker_id,
      attempts=attempts+1,
      started_at=coalesce(started_at,now()),
      lease_expires_at=now()+interval '30 minutes',
      updated_at=now(),
      last_error=null
  where id=claimed_id
  returning *;
end;
$$;

revoke all on function public.claim_audit_job(text) from public;
grant execute on function public.claim_audit_job(text) to service_role;
