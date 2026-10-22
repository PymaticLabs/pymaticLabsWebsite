-- Licencias a mano (LICENSE_MODE=manual) y el estado de la entrega para la comprobacion de produccion.
--
-- Hasta que el producto acepte la clave de la web, cada licencia la firma Eric en su Mac (la clave
-- de licencias.pub) con un numero de su numeracion, del 0001 al 5000, y la sube
-- (scripts/subir-licencia.mts). La web la pide (license_requests) y, al subirla, la guarda en
-- licenses con origin = 'manual'. Las de la web siguen del 5001 al 9999: los dos rangos nunca se
-- cruzan, y la base de datos lo comprueba.

alter table public.licenses
  add column origin text not null default 'web' check (origin in ('web', 'manual'));

alter table public.licenses drop constraint if exists licenses_id_check;
alter table public.licenses add constraint licenses_id_range check (
  (origin = 'web' and id ~ '^PML-LIC-[0-9]{4}-(500[1-9]|50[1-9][0-9]|5[1-9][0-9]{2}|[6-9][0-9]{3})$')
  or (origin = 'manual' and id ~ '^PML-LIC-[0-9]{4}-([0-4][0-9]{3}|5000)$' and id !~ '-0000$')
);

-- Una licencia pedida a Eric por compra: lo que tiene que llevar, sacado de la compra.
create table public.license_requests (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null unique references public.purchases (id),
  company_id uuid not null references public.companies (id),
  kind text not null check (kind in ('one_time', 'renewal')),
  payment_ref text not null,
  cliente text not null,
  nif text not null,
  modalidad text not null,
  equipo boolean not null,
  seats integer not null,
  emitida date not null,
  soporte_hasta date not null,
  livemode boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'issued', 'cancelled')),
  license_id text references public.licenses (id),
  cancel_reason text,
  issued_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index license_requests_pending on public.license_requests (created_at) where status = 'pending';
create index license_requests_company on public.license_requests (company_id);

-- Interna: solo el servidor (service_role). La zona la ensena como "en camino" desde el servidor.
alter table public.license_requests enable row level security;
revoke all on public.license_requests from anon, authenticated;
grant select, insert, update, delete on public.license_requests to service_role;

-- Lo que la comprobacion de produccion (scripts/comprobar-produccion.mts, /api/admin/health) no ve
-- por la API: las tareas de pg_cron, que esten los dos secretos de Vault (sin leerlos), los buckets
-- y las extensiones. Solo lee. Cada parte por separado: si una no se puede mirar, dice null.
create or replace function public.entrega_estado()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb := '{}'::jsonb;
begin
  begin
    v_result := v_result || jsonb_build_object('cron', (
      select coalesce(jsonb_agg(jsonb_build_object('nombre', jobname, 'activa', active) order by jobname), '[]'::jsonb)
      from cron.job where jobname like 'entrega-%'));
  exception when others then
    v_result := v_result || jsonb_build_object('cron', null);
  end;
  begin
    v_result := v_result || jsonb_build_object('vault', (
      select coalesce(jsonb_agg(name order by name), '[]'::jsonb)
      from vault.secrets where name in ('entrega_site_url', 'entrega_jobs_secret')));
  exception when others then
    v_result := v_result || jsonb_build_object('vault', null);
  end;
  begin
    v_result := v_result || jsonb_build_object('buckets', (
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'publico', public) order by id), '[]'::jsonb)
      from storage.buckets where id in ('releases', 'customer-files')));
  exception when others then
    v_result := v_result || jsonb_build_object('buckets', null);
  end;
  v_result := v_result || jsonb_build_object('extensiones', (
    select coalesce(jsonb_agg(extname order by extname), '[]'::jsonb)
    from pg_extension where extname in ('pg_cron', 'pg_net')));
  return v_result;
end;
$$;

revoke execute on function public.entrega_estado() from public, anon, authenticated;
grant execute on function public.entrega_estado() to service_role;
