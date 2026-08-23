-- Eden Clinic Network
-- Durable booking/session state
--
-- One browser/session has one current persisted booking snapshot.
-- booking_record_id remains the canonical appointment identity.
-- booking_data stores the complete working booking object.

create table if not exists public.booking_sessions (
  session_id text primary key,

  clinic_id text not null default '',

  booking_record_id text not null default '',

  booking_data jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now()
);

create index if not exists
  booking_sessions_clinic_id_idx
on public.booking_sessions (clinic_id);

create index if not exists
  booking_sessions_booking_record_id_idx
on public.booking_sessions (booking_record_id);

alter table public.booking_sessions
  enable row level security;

grant select, insert, update, delete
on table public.booking_sessions
to service_role;
