-- Lock down Supabase PostgREST (anon / authenticated).
-- With RLS on and no policies, the public API cannot read or write these tables.
-- FastAPI keeps working: it connects via DATABASE_URL as a privileged DB role
-- that bypasses RLS (table owner / postgres), so do NOT use FORCE ROW LEVEL SECURITY.

alter table public.universities enable row level security;
alter table public.users enable row level security;
alter table public.tournaments enable row level security;
alter table public.courts enable row level security;
alter table public.teams enable row level security;
alter table public.team_players enable row level security;
alter table public.registrations enable row level security;
alter table public.payments enable row level security;
alter table public.groups enable row level security;
alter table public.group_teams enable row level security;
alter table public.matches enable row level security;
alter table public.match_scores enable row level security;
alter table public.rankings enable row level security;
alter table public.ranking_history enable row level security;
alter table public.announcements enable row level security;
alter table public.sponsors enable row level security;
alter table public.platform_settings enable row level security;
alter table public.friendships enable row level security;
alter table public.community_competitions enable row level security;
alter table public.competition_members enable row level security;
alter table public.community_matches enable row level security;
alter table public.profile_media enable row level security;
alter table public.tournament_admins enable row level security;
