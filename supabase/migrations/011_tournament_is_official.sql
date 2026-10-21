-- Public listing flag: only official (admin) tournaments appear on landing / browse.
alter table public.tournaments
  add column if not exists is_official boolean not null default false;

-- Existing events that were already public: keep listed if owned by a platform admin,
-- or the seeded Limerick Open slug.
update public.tournaments t
set is_official = true
where t.slug = 'limerick-open'
   or exists (
     select 1 from public.users u
     where u.id = t.organiser_id and u.role = 'ADMIN'
   );
