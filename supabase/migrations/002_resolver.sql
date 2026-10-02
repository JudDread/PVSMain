-- 002: resolver for due actions

create or replace function public.resolve_due_actions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  n integer := 0;
begin
  for a in
    select * from scheduled_actions
    where status = 'pending' and resolve_at <= now()
    order by resolve_at
    for update skip locked
  loop
    if a.action_type = 'travel' then
      update ships
        set state = 'docked', docked_at = a.payload->>'to', plan = null
        where id = a.ship_id;

      update scheduled_actions
        set status = 'resolved', resolved_at = now(),
            result = jsonb_build_object('docked_at', a.payload->>'to')
        where id = a.id;

      insert into event_log (character_id, kind, message, data)
        values (a.character_id, 'arrival',
                'Your ship arrived at ' || (a.payload->>'to') || '.',
                jsonb_build_object('action_id', a.id, 'due_at', a.resolve_at));
    else
      update scheduled_actions
        set status = 'failed', resolved_at = now(),
            result = jsonb_build_object('error', 'unknown_action_type')
        where id = a.id;
    end if;
    n := n + 1;
  end loop;

  insert into game_state (key, value)
    values ('last_resolve', to_jsonb(now()))
    on conflict (key) do update set value = excluded.value;

  return n;
end;
$$;

-- players must not be able to call this from the browser
revoke all on function public.resolve_due_actions() from public, anon, authenticated;

create extension if not exists pg_cron;

select cron.schedule(
  'resolve-due-actions',
  '* * * * *',
  $$select public.resolve_due_actions()$$
);
