-- ============================================================
-- Tidrapport – Supabase-schema
-- Kör hela filen i Supabase Dashboard → SQL Editor → New query → Run.
-- Skapar fyra tabeller med Row Level Security så att bara du
-- (inloggad användare) ser dina egna rader. Kan köras om.
-- ============================================================

create extension if not exists "pgcrypto";

-- Kunder ------------------------------------------------------
create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  hourly_rate numeric(10,2) not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Projekt per kund (eget timpris valfritt, annars kundens) -----
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  name        text not null,
  hourly_rate numeric(10,2),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Tidposter (en rad per dag, kund och projekt) -----------------
create table if not exists public.entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null,
  client_id   uuid not null references public.clients(id) on delete cascade,
  project_id  uuid references public.projects(id) on delete cascade,
  hours       numeric(5,2) not null check (hours >= 0 and hours <= 24),
  note        text default '',
  reported_at timestamptz,               -- när dagen rapporterades i Kleer
  created_at  timestamptz not null default now()
);

-- En rad per dag/kund/projekt. Två index eftersom project_id kan vara null.
create unique index if not exists entries_uniq_project
  on public.entries (user_id, date, client_id, project_id) where project_id is not null;
create unique index if not exists entries_uniq_no_project
  on public.entries (user_id, date, client_id) where project_id is null;
create index if not exists entries_user_date_idx on public.entries (user_id, date);

-- Fakturor (betald/ej betald per kund och månad) ---------------
create table if not exists public.invoices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  month       text not null,             -- 'YYYY-MM'
  paid        boolean not null default false,
  paid_at     timestamptz,
  unique (user_id, client_id, month)
);

-- Row Level Security -------------------------------------------
alter table public.clients  enable row level security;
alter table public.projects enable row level security;
alter table public.entries  enable row level security;
alter table public.invoices enable row level security;

drop policy if exists "own clients"  on public.clients;
drop policy if exists "own projects" on public.projects;
drop policy if exists "own entries"  on public.entries;
drop policy if exists "own invoices" on public.invoices;

create policy "own clients"  on public.clients  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own projects" on public.projects for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own entries"  on public.entries  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own invoices" on public.invoices for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Praktisk vy för egna SQL-frågor: veckosummor per kund och projekt
create or replace view public.weekly_summary as
select e.user_id,
       c.name  as client,
       p.name  as project,
       extract(isoyear from e.date)::int as iso_year,
       extract(week    from e.date)::int as iso_week,
       min(e.date) as first_day,
       max(e.date) as last_day,
       sum(e.hours) as hours,
       sum(e.hours * coalesce(p.hourly_rate, c.hourly_rate)) as amount,
       bool_and(e.reported_at is not null) as fully_reported
from public.entries e
join public.clients c on c.id = e.client_id
left join public.projects p on p.id = e.project_id
group by e.user_id, c.name, p.name, 4, 5;
