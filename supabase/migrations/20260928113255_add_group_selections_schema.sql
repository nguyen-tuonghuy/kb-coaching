create table public.coaching_group_selections (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.coaching_groups(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  selection_type text not null default 'competition'
    check (selection_type in ('competition','stage','other')),
  starts_on date,
  ends_on date,
  archived boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coaching_group_selections_dates_check
    check (starts_on is null or ends_on is null or starts_on <= ends_on),
  constraint coaching_group_selections_group_name_key unique (group_id, name),
  constraint coaching_group_selections_group_id_id_key unique (group_id, id)
);

create index coaching_group_selections_group_id_idx
  on public.coaching_group_selections(group_id);

create table public.coaching_group_selection_players (
  selection_id uuid not null,
  group_id uuid not null,
  player_id uuid not null,
  added_at timestamptz not null default now(),
  primary key (selection_id, player_id),
  constraint coaching_group_selection_players_selection_group_fkey
    foreign key (group_id, selection_id)
    references public.coaching_group_selections(group_id, id)
    on delete cascade,
  constraint coaching_group_selection_players_group_player_fkey
    foreign key (group_id, player_id)
    references public.coaching_group_players(group_id, player_id)
    on delete cascade
);

create index coaching_group_selection_players_group_player_idx
  on public.coaching_group_selection_players(group_id, player_id);

alter table public.matches
  add column selection_id uuid;

alter table public.matches
  add constraint matches_selection_group_fkey
  foreign key (group_id, selection_id)
  references public.coaching_group_selections(group_id, id)
  on delete restrict;

alter table public.matches
  add constraint matches_selection_requires_group_check
  check (selection_id is null or group_id is not null);

create index matches_selection_id_idx
  on public.matches(selection_id);

alter table public.coaching_group_selections enable row level security;
alter table public.coaching_group_selection_players enable row level security;
