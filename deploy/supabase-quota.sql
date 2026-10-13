-- Run once in a dedicated FREE Supabase project's SQL Editor.
-- Only the server service_role may reserve counters; browser roles have no access.
create schema if not exists quota_private;
revoke all on schema quota_private from public;
create table if not exists quota_private.days (
  day date primary key,
  total integer not null default 0 check (total >= 0)
);
create table if not exists quota_private.clients (
  day date not null references quota_private.days(day) on delete cascade,
  client text not null,
  total integer not null default 0 check (total >= 0),
  hour bigint not null,
  hourly integer not null default 0 check (hourly >= 0),
  primary key (day, client)
);
revoke all on all tables in schema quota_private from public;

create or replace function public.reserve_model_call(
  p_client text, p_daily_limit integer, p_client_limit integer, p_hourly_limit integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (current_timestamp at time zone 'Asia/Shanghai')::date;
  v_hour bigint := floor(extract(epoch from current_timestamp)/3600)::bigint;
  v_total integer;
  v_client quota_private.clients%rowtype;
begin
  if p_client is null or p_client !~ '^[a-f0-9]{64}$' or
     p_daily_limit is null or p_daily_limit not between 1 and 1000 or
     p_client_limit is null or p_client_limit not between 1 and 1000 or
     p_hourly_limit is null or p_hourly_limit not between 1 and 1000 then
    raise exception 'invalid quota input';
  end if;
  insert into quota_private.days(day) values(v_day) on conflict do nothing;
  -- This row lock serializes all reservations across replicas and restarts.
  select total into v_total from quota_private.days where day=v_day for update;
  if v_total >= p_daily_limit then return jsonb_build_object('allowed',false,'reason','limit'); end if;
  insert into quota_private.clients(day,client,hour) values(v_day,p_client,v_hour) on conflict do nothing;
  select * into v_client from quota_private.clients where day=v_day and client=p_client;
  if v_client.hour <> v_hour then v_client.hourly := 0; end if;
  if v_client.total >= p_client_limit or v_client.hourly >= p_hourly_limit then
    return jsonb_build_object('allowed',false,'reason','limit');
  end if;
  update quota_private.days set total=total+1 where day=v_day;
  update quota_private.clients set total=total+1,hour=v_hour,hourly=v_client.hourly+1
    where day=v_day and client=p_client;
  -- Retain at most seven days of counters, no audio, images, text, or raw IP.
  delete from quota_private.days where day < v_day-6;
  return jsonb_build_object('allowed',true);
end;
$$;
revoke all on function public.reserve_model_call(text,integer,integer,integer) from public;
revoke all on function public.reserve_model_call(text,integer,integer,integer) from anon,authenticated;
grant execute on function public.reserve_model_call(text,integer,integer,integer) to service_role;
