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

Fill `backend/.env` from `.env.example`:

- `SECRET_KEY` — long random string
- `DATABASE_URL` — Supabase Postgres URL
- `FRONTEND_URL` / `BACKEND_URL` — live domains
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`
- `RESEND_API_KEY`, `EMAIL_FROM`
- Frontend `VITE_API_URL` — your Render API URL

Run `supabase/migrations/001_initial.sql` on Supabase before first deploy.

## Phases shipped in this MVP

1. **Foundation** — auth, roles (PLAYER / ORGANISER / ADMIN), schema, seed data  
2. **Tournament** — create, register + pay (Stripe or demo), teams, configurable generator  
3. **Live event** — fixtures, scoring (organiser only), standings, player mobile view, QR, TV `/tournament/:id/display`  
4. **Community** — friends, private competitions/ladders, log singles & doubles matches  
5. **Ratings** — doubles-aware Elo (team average of partners vs both opponents); updates on tournament + community matches  
6. **Platform** — public profiles, Ireland rankings board  
7. **Business (stubs)** — sponsors table, announcements, organiser revenue stats  

## Environment

See `backend/.env.example`. For Supabase, set `DATABASE_URL` to the Postgres connection string and run `supabase/migrations/001_initial.sql`. Never put the service-role key in the frontend.

## Deploy sketch

- Frontend → Vercel (`frontend/`, build `npm run build`, output `dist`)  
- Backend → Render (`uvicorn app.main:app`)  
- DB → Supabase  

## V1 explicitly deferred

Native apps, chat, AI, push/SMS, subscriptions, multi-country, advanced stats — see the product spec.
