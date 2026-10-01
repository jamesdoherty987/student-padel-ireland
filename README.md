# Student Padel Ireland

Ireland's student padel competition platform. Contained in this folder so you can later move it to its own repo.

## Stack

| Layer | Choice |
|--------|--------|
| Frontend | React + Vite + TypeScript (Vercel / static) |
| Backend | FastAPI (Render) |
| Database | SQLite locally · **Supabase Postgres** in production |
| Payments | Stripe Checkout (demo mode without keys) |
| Email | Resend (optional) |

UI: simple tournament-first site (Outfit, court green). Payments via Stripe when keys are set; local demo mode otherwise.

## Quick start

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
PYTHONPATH=. uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

### Demo accounts (seeded on first backend start)

| Role | Email | Password |
|------|--------|----------|
| Player | james@ul.ie | player12345 |
| Organiser | organiser@studentpadelireland.ie | organiser123 |
| Admin | admin@studentpadelireland.ie | admin12345 |

Seeded tournament: **Limerick Open** (`/t/limerick-open`)

## Tests

```bash
cd backend
source .venv/bin/activate
PYTHONPATH=. pytest tests/ -v
```

Tournament generator tests cover 8–64 team fields, no self-matches, full group round-robins, court scheduling, and the classic 48 teams / 6 courts case.

## Production checklist

### Cost (MVP / early)

| Service | Typical early cost |
|--------|---------------------|
| **Supabase** Postgres | **Free** (500 MB, pauses after ~1 week idle) · **~$25/mo** Pro if you need always-on |
| **Render** API | **Free** (spins down after ~15 min idle - first request is slow) · ~$7/mo starter for always-on |
| **Vercel** frontend | **Free** hobby for most early traffic |
| **Stripe** | Free to set up; ~1.5% + €0.25 per EU card payment when you turn it on |

You can launch for **€0/month** on free tiers. Expect cold starts on Render free + possible Supabase pause if the site sits idle.

### Backend (Render)

1. Create a Supabase project → SQL editor → run `supabase/migrations/001_initial.sql` then `002_community_ratings.sql`
2. Copy the Postgres connection string into Render `DATABASE_URL` (plain `postgresql://…` is fine - the app normalizes it)
3. Deploy with `render.yaml` (or connect the `backend/` folder). Set:
   - `ENVIRONMENT=production`
   - `SECRET_KEY` - long random (Render can generate)
   - `DATABASE_URL` - Supabase URI
   - `FRONTEND_URL` - your Vercel URL (no trailing slash)
   - `BACKEND_URL` - your Render API URL
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD` - first admin (demo accounts are **not** created in production)
4. Stripe keys optional until you charge fees (demo payments until then)

### Frontend (Vercel)

- Root directory: `frontend`
- Build: `npm run build` · Output: `dist`
- Env: `VITE_API_URL=https://your-api.onrender.com` (must rebuild after changing)
- Optional: `VITE_WEB_ORIGIN=https://your-domain` for QR / invite links

### Native apps (Capacitor → App Store / Play)

See [frontend/MOBILE.md](frontend/MOBILE.md). Short version:

```bash
cd frontend
export VITE_API_URL=https://your-api.onrender.com
export VITE_WEB_ORIGIN=https://studentpadelireland.ie
npm run cap:ios    # Xcode → Archive → TestFlight
```

Bundle ID: `ie.studentpadelireland.app`

### Phases shipped in this MVP

1. **Foundation** - auth, roles (PLAYER / ORGANISER / ADMIN), schema, seed data  
2. **Tournament** - create, register + pay (Stripe or demo), teams, configurable generator  
3. **Live event** - fixtures, scoring (organiser only), standings, player mobile view, QR, TV `/tournament/:id/display`  
4. **Community** - friends, private competitions/ladders, log singles & doubles matches  
5. **Ratings** - doubles-aware Elo (team average of partners vs both opponents); updates on tournament + community matches  
6. **Platform** - public profiles, Ireland rankings board  
7. **Business (stubs)** - sponsors table, announcements, organiser revenue stats  
8. **Native shell** - Capacitor iOS/Android (`frontend/MOBILE.md`) - App Store / Play packaging ready; chat, push, IAP still deferred  

## Environment

See `backend/.env.example`. For Supabase, set `DATABASE_URL` to the Postgres connection string and run `supabase/migrations/001_initial.sql`. Never put the service-role key in the frontend.

## Deploy sketch

- Frontend → Vercel (`frontend/`, build `npm run build`, output `dist`)  
- Backend → Render (`uvicorn app.main:app`)  
- DB → Supabase  
- Native → Capacitor (`npm run cap:ios` / `cap:android` after setting `VITE_API_URL`)  

## V1 explicitly deferred

Chat, AI, push/SMS, subscriptions, multi-country, advanced stats, App Store IAP - see the product spec.
