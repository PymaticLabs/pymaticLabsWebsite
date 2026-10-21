-- Entrega automatica tras el pago del Cerebro Digital (PML-KB-0261).
--
-- Supabase en la region de la UE (Frankfurt). Escribe solo el servidor de la web, con la clave
-- service_role; la zona de clientes lee con la sesion del cliente y seguridad por filas (RLS):
-- cada persona ve solo lo de su empresa, y lo de facturacion solo quien compro.
--
-- Cada pago se procesa una vez: purchases.payment_ref es unico (pi_... en el pago unico, in_...
-- en cada cobro del mensual) y cada paso de la cola tiene una clave unica (jobs.key).
--
-- Nada de lo que se cree despues queda escribible desde el navegador: los privilegios por defecto
-- de las tablas nuevas tampoco dan escritura a anon ni a authenticated.
alter default privileges in schema public revoke insert, update, delete, truncate on tables from anon, authenticated;

-- Empresas (el titular de la licencia: razon social y NIF o NIF-IVA)
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tax_id text not null unique check (tax_id ~ '^[A-Z0-9-]+$'),
  tax_id_type text,
  country text,
  address jsonb,
  email text not null check (email = lower(email)),
  locale text not null default 'es' check (locale in ('es', 'en')),
  currency text not null default 'eur',
  stripe_customer_id text unique,
  holded_contact_id text,
  seats integer not null default 1 check (seats between 1 and 10),
  subscription_id text,
  subscription_status text,
  subscription_plan text,
  subscription_event_at timestamptz,
  access_revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- Personas con acceso a la zona: quien compro (owner) y su equipo (member), hasta seats
create table public.members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null check (email = lower(email)),
  user_id uuid references auth.users (id) on delete set null,
  role text not null check (role in ('owner', 'member')),
  added_by uuid,
  -- La compra que la hizo titular (si se devuelve, pierde lo que le dio). La clave ajena, tras purchases.
  purchase_id uuid,
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
create unique index members_active_email on public.members (company_id, email) where removed_at is null;
create index members_active_user on public.members (user_id) where removed_at is null;
create index members_active_by_email on public.members (email) where removed_at is null;

-- Compras: el pago unico (one_time) y cada cobro del mensual (renewal)
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id),
  kind text not null check (kind in ('one_time', 'renewal')),
  product text not null,
  payment_ref text not null unique,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  stripe_invoice_id text unique,
  stripe_subscription_id text,
  stripe_customer_id text,
  email text not null,
  locale text not null default 'es' check (locale in ('es', 'en')),
  currency text not null,
  amount_subtotal bigint not null,
  amount_discount bigint not null default 0,
  amount_tax bigint not null default 0,
  amount_total bigint not null,
  amount_refunded bigint not null default 0,
  tax_treatment text not null check (tax_treatment in ('standard', 'reverse_charge', 'export', 'exempt')),
  tax_rate numeric(5, 2),
  launch boolean not null default false,
  seats integer not null default 1,
  terms_version text,
  terms_sha256 text,
  terms_accepted_at timestamptz,
  marketing_opt_in boolean not null default false,
  session_host text,
  session_start timestamptz,
  calendar_reservation text,
  support_until date,
  status text not null default 'paid'
    check (status in ('paid', 'needs_review', 'refunded', 'partially_refunded', 'disputed', 'dispute_lost')),
  -- Stripe en vivo o de prueba: una compra de prueba nunca se firma con la clave de produccion.
  livemode boolean not null default false,
  reserved_license_id text unique,
  welcome_sent_at timestamptz,
  review_data jsonb,
  paid_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index purchases_company on public.purchases (company_id);
create index purchases_paid_at on public.purchases (paid_at);

alter table public.members
  add constraint members_purchase_fk foreign key (purchase_id) references public.purchases (id) on delete set null;

-- Licencias firmadas por la web (clave propia en KMS). content es el fichero tal cual. La web numera
-- del 5001 al 9999 de cada anyo; del 0001 al 5000 son del Mac de Eric: nunca coinciden.
create table public.licenses (
  id text primary key check (id ~ '^PML-LIC-[0-9]{4}-(500[1-9]|50[1-9][0-9]|5[1-9][0-9]{2}|[6-9][0-9]{3})$'),
  company_id uuid not null references public.companies (id),
  purchase_id uuid not null unique references public.purchases (id),
  payment_ref text not null,
  modalidad text not null,
  equipo boolean not null,
  emitida date not null,
  soporte_hasta date not null,
  file_name text not null,
  content text not null,
  key_id text not null,
  public_key text not null,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz not null default now()
);
create index licenses_company on public.licenses (company_id);
create index licenses_created on public.licenses (created_at);

-- Facturas y rectificativas de Holded, con su PDF guardado para la zona
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  purchase_id uuid not null references public.purchases (id),
  kind text not null check (kind in ('invoice', 'credit_note')),
  ref text not null unique,
  provider text not null default 'holded',
  provider_id text,
  number text,
  status text not null check (status in ('draft', 'approved', 'sent')),
  amount_total bigint not null,
  currency text not null,
  storage_path text,
  rectifies uuid references public.invoices (id),
  -- Por que no se emite sola (NIF-IVA sin verificar, en USD, totales que no cuadran): borrador.
  hold_reason text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  sent_at timestamptz
);
create index invoices_company on public.invoices (company_id);
create index invoices_drafts on public.invoices (status) where status = 'draft';

-- Sesiones del Acompanado (Cal.com): la primera se elige al comprar, la segunda desde la zona
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  purchase_id uuid not null references public.purchases (id),
  number integer not null check (number in (1, 2)),
  host text not null,
  start_at timestamptz not null,
  provider_uid text,
  status text not null check (status in ('booked', 'failed', 'cancelled')),
  note text,
  created_at timestamptz not null default now(),
  unique (purchase_id, number)
);

-- Versiones del esqueleto y sus ficheros en el almacen privado (bucket releases)
create table public.versions (
  id text primary key check (id ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  notes_es text not null,
  notes_en text not null,
  published_at timestamptz not null default now(),
  announced_at timestamptz
);

create table public.version_files (
  id uuid primary key default gen_random_uuid(),
  version_id text not null references public.versions (id) on delete cascade,
  kind text not null check (kind in ('mac', 'windows', 'registry', 'sbom', 'checksum', 'other')),
  lang text check (lang in ('es', 'en')),
  file_name text not null,
  storage_path text not null unique,
  size_bytes bigint,
  sha256 text,
  team_only boolean not null default false,
  created_at timestamptz not null default now()
);

-- Avisos de Stripe recibidos (registro y atajo para los repetidos)
create table public.stripe_events (
  id text primary key,
  type text not null,
  livemode boolean not null default false,
  stripe_created_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  outcome text
);

-- Cola de pasos con reintentos. Un paso espera a los de depends_on (por su clave).
create table public.jobs (
  id bigint generated always as identity primary key,
  key text not null unique,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  depends_on text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'dead')),
  attempts integer not null default 0,
  max_attempts integer not null default 10,
  next_run_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  alerted_at timestamptz,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz
);
create index jobs_due on public.jobs (next_run_at) where status in ('pending', 'running');
create index jobs_dead on public.jobs (updated_at) where status = 'dead';

-- Secuencia de ids de licencia de la web por anyo (PML-LIC-<anyo>-NNNN), en su propio rango: empieza
-- cada anyo en el 5001 sola, sin sembrarla.
create table public.license_sequences (
  year integer primary key,
  last_number integer not null check (last_number between 5001 and 9999)
);

-- Limites por IP y por correo (codigos de la zona, pagos abiertos, altas del equipo), en ventanas
-- fijas. key lleva huellas (HMAC con sal) de la IP o del correo, nunca el dato.
create table public.rate_limits (
  key text primary key,
  hits integer not null,
  reset_at timestamptz not null
);
create index rate_limits_reset on public.rate_limits (reset_at);

-- Plazas del precio de lanzamiento: se reservan al crear el pago y se gastan al cobrarlo
create table public.launch_slots (
  ref text primary key,
  product text not null,
  client_hash text,
  status text not null check (status in ('reserved', 'used', 'released')),
  expires_at timestamptz not null,
  checkout_session_id text,
  created_at timestamptz not null default now()
);
create index launch_slots_active on public.launch_slots (status, expires_at);

-- El siguiente numero de licencia del anyo, atomico: dos ventas a la vez nunca comparten id. Pasado
-- el 9999, la comprobacion de la tabla para la venta (y la cola avisa).
create or replace function public.next_license_number(p_year integer, p_first integer default 5001)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.license_sequences as s (year, last_number)
  values (p_year, p_first)
  on conflict (year) do update set last_number = greatest(s.last_number, p_first - 1) + 1
  returning last_number;
$$;

-- Una devolucion, sin volver atras aunque lleguen dos avisos a la vez o desordenados: lo devuelto
-- solo sube, y el estado pasa a refunded (total) o a partially_refunded (si estaba pagada).
create or replace function public.record_refund(p_id uuid, p_total bigint, p_full boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed boolean;
begin
  update public.purchases
  set amount_refunded = greatest(amount_refunded, p_total),
      status = case when p_full then 'refunded' when status = 'paid' then 'partially_refunded' else status end
  where id = p_id
    and (amount_refunded < p_total or (p_full and status <> 'refunded') or (not p_full and status = 'paid'))
  returning true into v_changed;
  return coalesce(v_changed, false);
end;
$$;

-- Un intento mas en la ventana de esa clave (atomico): devuelve los de la ventana y cuando acaba.
create or replace function public.rate_limit_hit(p_key text, p_window_seconds integer)
returns table (hits integer, reset_at timestamptz)
language sql
security definer
set search_path = public
as $$
  insert into public.rate_limits as r (key, hits, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (key) do update set
    hits = case when r.reset_at <= now() then 1 else r.hits + 1 end,
    reset_at = case when r.reset_at <= now() then now() + make_interval(secs => p_window_seconds) else r.reset_at end
  returning r.hits, r.reset_at;
$$;

-- El equipo no pasa de las plazas compradas, aunque lleguen dos altas a la vez: se bloquea la empresa
-- y se cuenta. Los titulares (compras) no cuentan para este tope.
create or replace function public.members_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seats integer;
  v_active integer;
begin
  if new.role <> 'member' or new.removed_at is not null then
    return new;
  end if;
  select seats into v_seats from public.companies where id = new.company_id for update;
  select count(*) into v_active from public.members where company_id = new.company_id and removed_at is null;
  if v_active >= coalesce(v_seats, 1) then
    raise exception 'seat_limit: la empresa ya tiene sus % plazas', v_seats using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger members_seat_limit
  before insert on public.members
  for each row execute function public.members_seat_limit();

-- El id de la cuenta de un correo, para el alta de quien ya tenia cuenta (sin generar enlaces de
-- acceso que no hacen falta). Solo el servidor.
create or replace function public.user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.id from auth.users u where lower(u.email) = lower(p_email) order by u.created_at limit 1;
$$;

-- Coge pasos que tocan (o bloqueados por un intento que murio), con sus dependencias hechas.
-- skip locked: dos trabajadores a la vez nunca cogen el mismo.
create or replace function public.claim_jobs(p_limit integer, p_lock_seconds integer default 120)
returns setof public.jobs
language sql
security definer
set search_path = public
as $$
  update public.jobs j
  set status = 'running',
      attempts = j.attempts + 1,
      locked_until = now() + make_interval(secs => p_lock_seconds),
      updated_at = now()
  where j.id in (
    select c.id
    from public.jobs c
    where ((c.status = 'pending' and c.next_run_at <= now()) or (c.status = 'running' and c.locked_until < now()))
      and not exists (
        select 1 from public.jobs d where d.key = any (c.depends_on) and d.status <> 'done'
      )
    order by c.next_run_at, c.id
    limit p_limit
    for update skip locked
  )
  returning j.*;
$$;

-- Reserva una plaza del precio de lanzamiento: false si ya estan las p_limit gastadas o
-- reservadas, o si ese cliente (hash de su IP) ya tiene p_client_limit abiertas.
create or replace function public.reserve_launch_slot(
  p_ref text,
  p_product text,
  p_client_hash text,
  p_expires_at timestamptz,
  p_limit integer,
  p_client_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_taken integer;
  v_client integer;
begin
  perform pg_advisory_xact_lock(hashtext('launch_slots'));
  select count(*) into v_taken
  from public.launch_slots
  where status = 'used' or (status = 'reserved' and expires_at > now());
  if v_taken >= p_limit then
    return false;
  end if;
  if p_client_hash is not null then
    select count(*) into v_client
    from public.launch_slots
    where client_hash = p_client_hash and status = 'reserved' and expires_at > now();
    if v_client >= p_client_limit then
      return false;
    end if;
  end if;
  insert into public.launch_slots (ref, product, client_hash, status, expires_at)
  values (p_ref, p_product, p_client_hash, 'reserved', p_expires_at);
  return true;
end;
$$;

revoke execute on function public.next_license_number(integer, integer) from public, anon, authenticated;
revoke execute on function public.record_refund(uuid, bigint, boolean) from public, anon, authenticated;
revoke execute on function public.rate_limit_hit(text, integer) from public, anon, authenticated;
revoke execute on function public.members_seat_limit() from public, anon, authenticated;
revoke execute on function public.user_id_by_email(text) from public, anon, authenticated;
revoke execute on function public.claim_jobs(integer, integer) from public, anon, authenticated;
revoke execute on function public.reserve_launch_slot(text, text, text, timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.next_license_number(integer, integer) to service_role;
grant execute on function public.record_refund(uuid, bigint, boolean) to service_role;
grant execute on function public.rate_limit_hit(text, integer) to service_role;
grant execute on function public.user_id_by_email(text) to service_role;
grant execute on function public.claim_jobs(integer, integer) to service_role;
grant execute on function public.reserve_launch_slot(text, text, text, timestamptz, integer, integer) to service_role;

-- Seguridad por filas: la zona lee con la sesion del cliente (auth.uid()). Una persona dada de alta
-- antes de tener cuenta (user_id vacio) se reconoce por su correo, solo si esta confirmado en
-- auth.users (no por lo que diga el token: un cambio de correo sin confirmar no hereda nada). La web
-- rellena user_id la primera vez que entra, y desde entonces ya no cuenta el correo.
-- Las empresas de la persona: con acceso vigente (una devolucion o un contracargo lo quitan).
create or replace function public.my_company_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.company_id
  from public.members m
  join public.companies c on c.id = m.company_id
  where (
      m.user_id = auth.uid()
      or (m.user_id is null and exists (
        select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null and lower(u.email) = m.email
      ))
    )
    and m.removed_at is null and c.access_revoked_at is null;
$$;

-- Las que compro ella: las facturas y los pagos solo los ve quien compro.
create or replace function public.my_owned_company_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.company_id
  from public.members m
  join public.companies c on c.id = m.company_id
  where (
      m.user_id = auth.uid()
      or (m.user_id is null and exists (
        select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null and lower(u.email) = m.email
      ))
    )
    and m.removed_at is null and m.role = 'owner' and c.access_revoked_at is null;
$$;

revoke execute on function public.my_company_ids() from public, anon;
revoke execute on function public.my_owned_company_ids() from public, anon;
grant execute on function public.my_company_ids() to authenticated;
grant execute on function public.my_owned_company_ids() to authenticated;

alter table public.companies enable row level security;
alter table public.members enable row level security;
alter table public.purchases enable row level security;
alter table public.licenses enable row level security;
alter table public.invoices enable row level security;
alter table public.bookings enable row level security;
alter table public.versions enable row level security;
alter table public.version_files enable row level security;
alter table public.stripe_events enable row level security;
alter table public.jobs enable row level security;
alter table public.license_sequences enable row level security;
alter table public.launch_slots enable row level security;
alter table public.rate_limits enable row level security;

-- Nadie escribe desde el navegador: solo el servidor, con service_role (que se salta RLS).
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
-- Lo interno no se lee ni con sesion.
revoke all on public.stripe_events, public.jobs, public.license_sequences, public.launch_slots, public.rate_limits from anon, authenticated;

create policy companies_read on public.companies
  for select to authenticated using (id in (select public.my_company_ids()));

create policy members_read on public.members
  for select to authenticated using (company_id in (select public.my_company_ids()));

create policy licenses_read on public.licenses
  for select to authenticated using (company_id in (select public.my_company_ids()));

create policy bookings_read on public.bookings
  for select to authenticated using (company_id in (select public.my_company_ids()));

create policy purchases_read on public.purchases
  for select to authenticated using (company_id in (select public.my_owned_company_ids()));

create policy invoices_read on public.invoices
  for select to authenticated using (company_id in (select public.my_owned_company_ids()));

-- Las versiones, para cualquier cliente con acceso; el instalador del registro, solo con equipo.
create policy versions_read on public.versions
  for select to authenticated using (exists (select 1 from public.my_company_ids()));

create policy version_files_read on public.version_files
  for select to authenticated using (
    exists (select 1 from public.my_company_ids())
    and (
      not team_only
      or exists (select 1 from public.companies c where c.id in (select public.my_company_ids()) and c.seats > 1)
    )
  );
