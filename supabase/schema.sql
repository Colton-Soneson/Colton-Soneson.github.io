-- THE ACCOUNTS AND THE SAVE SLOTS (code/accounts.js): run once in the Supabase dashboard's SQL Editor (paste it all, Run).
-- Signing up and logging in are Supabase Auth's (email and password). Each player has a profile (their username) and up to three
-- saves, each the game's save file (saveGame.js: HSV1, gzipped) as base64 text. Row level security: a player can only read and write
-- their own. It can be run again: it leaves what is there as it is.

-- PROFILES: a username for every account, made with the account from what it was signed up with
create table if not exists public.profiles (
	id uuid primary key references auth.users (id) on delete cascade,
	username text not null unique check (username ~ '^[A-Za-z0-9_]{3,20}$'),
	created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles for select using (auth.uid() = id);

create or replace function public.make_profile() returns trigger language plpgsql security definer set search_path = public as $$
begin
	insert into public.profiles (id, username) values (new.id, new.raw_user_meta_data ->> 'username');
	return new;
end;
$$;
drop trigger if exists on_signup_make_profile on auth.users;
create trigger on_signup_make_profile after insert on auth.users for each row execute function public.make_profile();

-- whether a username is taken (asked before signing up): yes or no only, nothing else about whose it is
create or replace function public.username_taken(name text) returns boolean language sql security definer set search_path = public as $$
	select exists (select 1 from public.profiles where lower(username) = lower(name));
$$;
grant execute on function public.username_taken(text) to anon, authenticated;

-- SAVES: three slots a player, each a save file and what the slot shows of it
create table if not exists public.saves (
	user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
	slot smallint not null check (slot between 1 and 3),
	name text not null default '' check (char_length(name) <= 40),
	day integer not null default 1,
	data text not null check (octet_length(data) < 2000000),
	updated_at timestamptz not null default now(),
	primary key (user_id, slot)
);
alter table public.saves enable row level security;
drop policy if exists "saves: read own" on public.saves;
drop policy if exists "saves: add own" on public.saves;
drop policy if exists "saves: change own" on public.saves;
drop policy if exists "saves: delete own" on public.saves;
create policy "saves: read own" on public.saves for select using (auth.uid() = user_id);
create policy "saves: add own" on public.saves for insert with check (auth.uid() = user_id);
create policy "saves: change own" on public.saves for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "saves: delete own" on public.saves for delete using (auth.uid() = user_id);
