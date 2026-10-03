-- 003: resolver can run for ONE character (used when a player looks),
-- or for everyone (used by the once-a-minute cron job).
-- The old zero-argument version must be dropped first, otherwise the two
-- versions would clash. The cron job keeps working unchanged: it calls
-- resolve_due_actions() with no argument, which now means "everyone".

drop function if exists public.resolve_due_actions();

create or replace function public.resolve_due_actions(p_character uuid default null)
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
    where status = 'pending'
      and resolve_at <= now()
      and (p_character is null or character_id = p_character)
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

  if p_character is null then
    insert into game_state (key, value)
      values ('last_resolve', to_jsonb(now()))
      on conflict (key) do update set value = excluded.value;
  end if;

  return n;
end;
$$;

revoke all on function public.resolve_due_actions(uuid) from public, anon, authenticated;
