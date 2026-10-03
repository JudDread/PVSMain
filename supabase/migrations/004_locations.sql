-- 004: locations (Module 4, step 1)
-- A BODY has an orbit (Earth, Mars...). A LOCATION is a place you can dock
-- (Luna, Titan, "Earth Orbit"...). Each location is anchored to a body.
-- Ships now remember a location id instead of a body name.

-- ---------- 1. the locations table ----------
create table public.locations (
  id text primary key,                 -- short code, e.g. 'luna'
  name text not null,                  -- display name, e.g. 'Luna'
  anchor_body text not null,           -- body name from physics.js, e.g. 'Earth'
  kind text not null default 'moon',   -- 'orbit' (default spot of a body), 'moon', later 'station', 'field'...
  offset_au numeric not null default 0 check (offset_au >= 0),
                                       -- distance from the anchor body (used for hop times)
  is_default boolean not null default false,  -- the place a ship lands when it flies to the body itself
  created_at timestamptz not null default now()
);

-- each body has exactly one default location
create unique index one_default_per_body
  on public.locations (anchor_body) where is_default;
create index locations_anchor_idx on public.locations (anchor_body);

-- players may READ locations; nobody can write from the browser
alter table public.locations enable row level security;
create policy "read locations" on public.locations
  for select to authenticated using (true);

-- ---------- 2. fill it (the Sun is not dockable) ----------
insert into public.locations (id, name, anchor_body, kind, offset_au, is_default) values
  ('mercury', 'Mercury Orbit', 'Mercury', 'orbit', 0, true),
  ('venus',   'Venus Orbit',   'Venus',   'orbit', 0, true),
  ('earth',   'Earth Orbit',   'Earth',   'orbit', 0, true),
  ('mars',    'Mars Orbit',    'Mars',    'orbit', 0, true),
  ('vesta',   'Vesta',         'Vesta',   'orbit', 0, true),
  ('ceres',   'Ceres',         'Ceres',   'orbit', 0, true),
  ('jupiter', 'Jupiter Orbit', 'Jupiter', 'orbit', 0, true),
  ('saturn',  'Saturn Orbit',  'Saturn',  'orbit', 0, true),
  ('uranus',  'Uranus Orbit',  'Uranus',  'orbit', 0, true),
  ('neptune', 'Neptune Orbit', 'Neptune', 'orbit', 0, true),
  -- moons (offset = real average distance from the planet, in AU)
  ('luna',      'Luna',      'Earth',   'moon', 0.002570, false),
  ('io',        'Io',        'Jupiter', 'moon', 0.002819, false),
  ('europa',    'Europa',    'Jupiter', 'moon', 0.004485, false),
  ('ganymede',  'Ganymede',  'Jupiter', 'moon', 0.007152, false),
  ('callisto',  'Callisto',  'Jupiter', 'moon', 0.012588, false),
  ('titan',     'Titan',     'Saturn',  'moon', 0.008168, false),
  ('enceladus', 'Enceladus', 'Saturn',  'moon', 0.001591, false),
  ('titania',   'Titania',   'Uranus',  'moon', 0.002914, false),
  ('triton',    'Triton',    'Neptune', 'moon', 0.002373, false);

-- ---------- 3. ships: body name -> location id ----------
alter table public.ships
  add column location_id text references public.locations(id);

-- existing docked ships: 'Earth' -> 'earth', 'Mars' -> 'mars', ...
update public.ships
  set location_id = lower(docked_at)
  where docked_at is not null;

-- dropping the old column also drops the old check rule that mentioned it
alter table public.ships drop column docked_at;

alter table public.ships add constraint ships_state_check2 check (
  (state = 'docked' and location_id is not null)
  or (state = 'traveling' and plan is not null)
);

-- ---------- 4. resolver: dock at a LOCATION ----------
-- New trips store payload.to_location (a location id).
-- Old pending trips only have payload.to (a body name), so we fall back to
-- the lower-case body name, which is that body's default location id.
create or replace function public.resolve_due_actions(p_character uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  dest text;
  dest_name text;
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
      dest := coalesce(a.payload->>'to_location', lower(a.payload->>'to'));
      select name into dest_name from locations where id = dest;

      update ships
        set state = 'docked', location_id = dest, plan = null
        where id = a.ship_id;

      update scheduled_actions
        set status = 'resolved', resolved_at = now(),
            result = jsonb_build_object('location_id', dest)
        where id = a.id;

      insert into event_log (character_id, kind, message, data)
        values (a.character_id, 'arrival',
                'Your ship arrived at ' || coalesce(dest_name, dest) || '.',
                jsonb_build_object('action_id', a.id, 'due_at', a.resolve_at, 'location_id', dest));
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
