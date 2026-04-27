# Deployment Guide

## Prerequisites

- Node.js 20+
- Supabase CLI: `npm install` (installed as dev dependency)
- `pg_dump` installed locally (for manual backups)
- GitHub repository with Actions enabled

## Environment Variables

Copy `.env.example` to `.env.local` and fill in your values:

```
VITE_SUPABASE_URL=https://fhzyxavhfjhwqvaibyeg.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key from Supabase Dashboard>
SUPABASE_ACCESS_TOKEN=<personal access token from supabase.com/dashboard/account/tokens>
```

Never commit `.env.local`.

## First-Time Setup

```bash
# Install dependencies
npm install

# Log in to Supabase CLI using your access token
npx supabase login --token <SUPABASE_ACCESS_TOKEN>

# Link to the remote project
npx supabase link --project-ref fhzyxavhfjhwqvaibyeg
```

## Frontend Deployment

**Automatic (CI/CD):** Push to `master` — GitHub Actions builds and deploys to GitHub Pages.

**Manual:**
```bash
npm run build
# Then push dist/ to the gh-pages branch, or deploy elsewhere
```

## Database Migrations

**Via CI/CD (manual trigger):**
Go to GitHub Actions > "Apply Database Migrations" > Run workflow.

**Locally:**
```bash
npx supabase db push
```

List current migration state:
```bash
npx supabase migration list
```

## Edge Function Deployment

```bash
npx supabase functions deploy health
npx supabase functions deploy get-daily-puzzle
npx supabase functions deploy submit-guess
# ... deploy each function by name
```

Or deploy all at once:
```bash
npx supabase functions deploy
```

## CI/CD Secrets Setup

Add these secrets to your GitHub repository (Settings > Secrets and variables > Actions):

| Secret | Where to get it |
|--------|----------------|
| `VITE_SUPABASE_URL` | Supabase Dashboard > Settings > API |
| `VITE_SUPABASE_ANON_KEY` | Supabase Dashboard > Settings > API |
| `SUPABASE_ACCESS_TOKEN` | supabase.com/dashboard/account/tokens |

## Health Check

```bash
curl https://fhzyxavhfjhwqvaibyeg.supabase.co/functions/v1/health
```

Expected response: `{"status":"healthy","timestamp":"...","db":{"puzzles_count":N}}`
