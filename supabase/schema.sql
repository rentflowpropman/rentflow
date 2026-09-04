-- RentFlow schema
-- Run this in the Supabase SQL editor (Project > SQL Editor > New query)

-- ─────────────────────────────────────────────────────────
-- PROFILES  (extends Supabase auth.users with a role)
-- ─────────────────────────────────────────────────────────
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'tenant' check (role in ('owner', 'staff', 'tenant')),
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- STAFF INVITES  (owner adds an email here before the person signs up;
-- the signup trigger below reads it to assign the right role)
-- ─────────────────────────────────────────────────────────
create table staff_invites (
  email text primary key,
  role text not null check (role in ('owner', 'staff')),
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- PROPERTIES & UNITS
-- ─────────────────────────────────────────────────────────
create table properties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  city text,
  province text,
  postal_code text,
  created_at timestamptz not null default now()
);

create table units (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  unit_number text not null,
  bedrooms numeric,
  bathrooms numeric,
  rent_amount numeric not null,
  status text not null default 'vacant' check (status in ('vacant', 'occupied', 'maintenance')),
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- APPLICATIONS  (public can insert, nobody but admin can read)
-- ─────────────────────────────────────────────────────────
create table applications (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete cascade,
  applicant_name text not null,
  applicant_email text not null,
  applicant_phone text,
  monthly_income numeric,
  employer text,
  references_text text,
  notes text,
  custom_fields jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- SETTINGS  (one row — admin-configurable app form + lease template)
-- ─────────────────────────────────────────────────────────
create table settings (
  id boolean primary key default true check (id), -- forces exactly one row
  application_form_fields jsonb not null default '[
    {"key": "phone", "label": "Phone", "type": "text", "required": false},
    {"key": "monthly_income", "label": "Monthly income", "type": "number", "required": false},
    {"key": "employer", "label": "Current employer", "type": "text", "required": false},
    {"key": "references_text", "label": "References (name + phone, one per line)", "type": "textarea", "required": false},
    {"key": "notes", "label": "Anything else we should know?", "type": "textarea", "required": false}
  ]'::jsonb,
  documenso_template_id text,
  lease_template_url text,
  created_at timestamptz not null default now()
);
insert into settings (id) values (true);

-- ─────────────────────────────────────────────────────────
-- TENANTS  (created when an application is approved)
-- ─────────────────────────────────────────────────────────
create table tenants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  email text not null,
  phone text,
  stripe_customer_id text,
  stripe_payment_method_id text,
  autopay_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- LEASES
-- ─────────────────────────────────────────────────────────
create table leases (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  rent_amount numeric not null,
  deposit_amount numeric not null default 0,
  status text not null default 'draft' check (status in ('draft', 'sent', 'signed', 'ended')),
  document_url text,
  documenso_document_id text,
  signed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- PAYMENTS
-- ─────────────────────────────────────────────────────────
create table payments (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid not null references leases(id) on delete cascade,
  amount numeric not null,
  type text not null default 'rent' check (type in ('rent', 'deposit', 'late_fee', 'other')),
  due_date date not null,
  paid_at timestamptz,
  status text not null default 'due' check (status in ('due', 'paid', 'late')),
  stripe_payment_intent_id text,
  autopay_attempted boolean not null default false,
  reminder_sent_at timestamptz,
  late_notice_sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- EXPENSES  (admin-side bookkeeping)
-- ─────────────────────────────────────────────────────────
create table expenses (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  category text not null,
  vendor text,
  amount numeric not null,
  incurred_on date not null default current_date,
  notes text,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- MAINTENANCE REQUESTS
-- ─────────────────────────────────────────────────────────
create table maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  description text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  created_at timestamptz not null default now()
);

-- ═════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═════════════════════════════════════════════════════════

alter table profiles enable row level security;
alter table properties enable row level security;
alter table units enable row level security;
alter table applications enable row level security;
alter table tenants enable row level security;
alter table leases enable row level security;
alter table payments enable row level security;
alter table expenses enable row level security;
alter table maintenance_requests enable row level security;
alter table staff_invites enable row level security;

-- Helper: does the current user have day-to-day management access
-- (applications, tenants, leases, maintenance) — owner or staff?
create or replace function has_management_access() returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role in ('owner', 'staff')
  );
$$ language sql security definer stable;

-- Helper: is the current user specifically the owner? (finances, settings,
-- team management — things staff should NOT see or change)
create or replace function is_owner() returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'owner'
  );
$$ language sql security definer stable;

-- profiles: everyone can read their own row; owner can read all (to manage the team)
create policy "read own profile" on profiles for select
  using (id = auth.uid() or is_owner());
create policy "update own profile" on profiles for update
  using (id = auth.uid());

-- staff_invites: owner only
create policy "owner manages staff invites" on staff_invites for all
  using (is_owner());

-- properties/units: owner+staff full access; tenants can read units they lease
create policy "management manages properties" on properties for all
  using (has_management_access());
create policy "management manages units" on units for all
  using (has_management_access());
create policy "tenants read their unit" on units for select
  using (
    id in (select unit_id from leases l join tenants t on t.id = l.tenant_id where t.user_id = auth.uid())
  );

-- applications: anyone (even anonymous) can INSERT; owner+staff can read/update
-- (approve/deny) — this is the piece staff specifically need
create policy "anyone can apply" on applications for insert
  with check (true);
create policy "management reads applications" on applications for select
  using (has_management_access());
create policy "management updates applications" on applications for update
  using (has_management_access());

-- tenants: owner+staff full access; a tenant can read their own row
create policy "management manages tenants" on tenants for all
  using (has_management_access());
create policy "tenant reads own record" on tenants for select
  using (user_id = auth.uid());

-- lets a newly-signed-in tenant "claim" their tenant row by matching email,
-- the first time they log in after being approved
create policy "tenant claims own record by email" on tenants for update
  using (user_id is null and email = auth.jwt()->>'email')
  with check (user_id = auth.uid());

-- leases: owner+staff full access (staff need to send/mark leases signed
-- as part of approving tenants); tenant reads their own lease(s)
create policy "management manages leases" on leases for all
  using (has_management_access());
create policy "tenant reads own lease" on leases for select
  using (tenant_id in (select id from tenants where user_id = auth.uid()));

-- payments: staff can see who paid (read-only) so they can answer tenant
-- questions, but only the owner can change amounts/records directly —
-- day-to-day, payments are written by the Stripe webhook (service role)
-- anyway, not by staff or owner from the browser
create policy "owner manages payments" on payments for all
  using (is_owner());
create policy "staff reads payments" on payments for select
  using (has_management_access());
create policy "tenant reads own payments" on payments for select
  using (lease_id in (
    select l.id from leases l join tenants t on t.id = l.tenant_id where t.user_id = auth.uid()
  ));

-- expenses: owner only — this is the financial data staff shouldn't see
create policy "owner manages expenses" on expenses for all
  using (is_owner());

-- maintenance: owner+staff full access; tenant manages their own requests
create policy "management manages maintenance" on maintenance_requests for all
  using (has_management_access());
create policy "tenant manages own maintenance" on maintenance_requests for all
  using (tenant_id in (select id from tenants where user_id = auth.uid()));

-- settings: readable by anyone (needed for the public application form to
-- know which fields to show), writable by the owner only
alter table settings enable row level security;
create policy "anyone reads settings" on settings for select
  using (true);
create policy "owner updates settings" on settings for update
  using (is_owner());
-- ─────────────────────────────────────────────────────────
create or replace function handle_new_user() returns trigger as $$
declare
  invited_role text;
begin
  select role into invited_role from staff_invites where email = new.email;

  insert into profiles (id, email, full_name, role)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', coalesce(invited_role, 'tenant'));

  if invited_role is not null then
    delete from staff_invites where email = new.email;
  end if;

  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ─────────────────────────────────────────────────────────
-- Daily autopay cron — run this block AFTER deploying the
-- charge-rent Edge Function, with your own project ref and
-- service role key substituted in.
-- ─────────────────────────────────────────────────────────
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- select cron.schedule(
--   'charge-rent-daily',
--   '0 13 * * *', -- 1pm UTC daily; adjust to your timezone
--   $$
--   select net.http_post(
--     url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/charge-rent',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY',
--       'Content-Type', 'application/json'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
--
-- select cron.schedule(
--   'send-rent-reminders-daily',
--   '0 14 * * *', -- 2pm UTC daily
--   $$
--   select net.http_post(
--     url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-rent-reminders',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY',
--       'Content-Type', 'application/json'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
