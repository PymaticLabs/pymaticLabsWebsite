-- El trabajador de la cola, cada minuto, y la conciliacion diaria, con pg_cron y pg_net.
--
-- La web procesa la cola al momento tras cada aviso de Stripe (after() de Next); esto la vuelve a
-- llamar cada minuto mientras quede algo que toque (reintentos con espera), y cada dia cruza
-- licencias y pagos.
--
-- Los dos secretos viven en Vault, nunca en el repo. Una vez, en el editor SQL de Supabase:
--   select vault.create_secret('https://pymaticlabs.com', 'entrega_site_url');
--   select vault.create_secret('<el JOBS_SECRET de Vercel>', 'entrega_jobs_secret');
-- Solo si la web de pruebas tiene la proteccion de Vercel, un tercero (opcional) con el secreto de
-- Protection Bypass for Automation, que va en la cabecera x-vercel-protection-bypass:
--   select vault.create_secret('<el secreto de bypass de Vercel>', 'entrega_vercel_bypass');

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.entrega_call(p_path text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text;
  v_secret text;
  v_bypass text;
  v_request bigint;
begin
  if p_path not in ('/api/jobs/run', '/api/jobs/reconcile') then
    raise exception 'entrega_call: ruta no permitida %', p_path;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'entrega_site_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'entrega_jobs_secret';
  select decrypted_secret into v_bypass from vault.decrypted_secrets where name = 'entrega_vercel_bypass';
  if v_url is null or v_secret is null then
    raise warning 'entrega: faltan entrega_site_url o entrega_jobs_secret en Vault';
    return null;
  end if;
  select net.http_post(
    url := rtrim(v_url, '/') || p_path,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret)
      || case when v_bypass is null then '{}'::jsonb else jsonb_build_object('x-vercel-protection-bypass', v_bypass) end,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into v_request;
  return v_request;
end;
$$;

-- Solo pg_cron (como postgres, su dueno) la llama: ni la clave secreta puede mandarla a otro sitio.
revoke execute on function public.entrega_call(text) from public, anon, authenticated, service_role;

-- Solo llama si hay un paso que toca: sin cola, ni una peticion.
select cron.schedule(
  'entrega-cola',
  '* * * * *',
  $$
  select public.entrega_call('/api/jobs/run')
  where exists (
    select 1 from public.jobs
    where (status = 'pending' and next_run_at <= now()) or (status = 'running' and locked_until < now())
  );
  $$
);

-- A las 05:15 UTC (de madrugada en Espana).
select cron.schedule('entrega-conciliacion', '15 5 * * *', $$ select public.entrega_call('/api/jobs/reconcile'); $$);

-- Las huellas de IP de las plazas de lanzamiento solo sirven mientras el pago esta abierto (no mas
-- de 2 abiertos por IP): al dia siguiente se borran (la politica de privacidad lo dice asi).
select cron.schedule(
  'entrega-huellas-ip',
  '30 5 * * *',
  $$ update public.launch_slots set client_hash = null where client_hash is not null and expires_at < now() - interval '1 day'; $$
);

-- Los contadores de los limites (con huellas de IP y de correo) se borran al dia de acabar su ventana.
select cron.schedule(
  'entrega-limites',
  '35 5 * * *',
  $$ delete from public.rate_limits where reset_at < now() - interval '1 day'; $$
);

-- pg_cron apunta cada ejecucion (la cola, una por minuto) y no las borra: se queda una semana.
select cron.schedule(
  'entrega-historial-cron',
  '40 5 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days'; $$
);
