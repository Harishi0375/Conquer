# Waypoint — a personal travel logbook

Mark the countries, cities, and streets you've actually visited on a world
map, and see your friends' maps overlaid on top of yours. Built with:

- **Frontend:** plain HTML/CSS/JS + [Leaflet.js](https://leafletjs.com/) (map)
  and [Nominatim](https://nominatim.org/) (free reverse geocoding — turns a
  map click into a city/country/street name). No build step, no framework.
- **Backend:** Node.js + Express, JWT auth, PostgreSQL.
- **Database:** plain Postgres (no PostGIS needed — we just store
  latitude/longitude as numbers).

---

## 1. Run it locally with Docker

Requirements: [Docker](https://docs.docker.com/get-docker/) and
Docker Compose (bundled with Docker Desktop on Windows; on Ubuntu install
`docker-compose-plugin`).

```bash
cd travel-map-app
docker compose up --build
```

This starts three containers:
- `postgres` on port 5432 (schema.sql runs automatically the first time)
- `backend` (the API) on port 3001
- `frontend` (nginx serving the static files) on port 8080

Open **http://localhost:8080** — register an account, click the map to log
a place, add a friend by username.

To stop: `Ctrl+C`, then `docker compose down` (add `-v` if you also want to
wipe the database volume).

---

## 2. Deploying it for free so friends can use it without installing anything

You'll deploy three pieces, all on free tiers:

| Piece      | Where          | Why |
|------------|----------------|-----|
| Database   | **Supabase**   | Free hosted Postgres |
| Backend    | **Render**     | Free web service hosting, runs your Express API |
| Frontend   | **Vercel**     | Free static hosting, gives you a public URL |

First, push this project to a GitHub repo (Render and Vercel both deploy
straight from GitHub) — create a new repo and push `travel-map-app/` to it.

### Step 2.1 — Database on Supabase

1. Go to [supabase.com](https://supabase.com), sign up, and create a new
   project (pick any region close to you).
2. Once it's ready, open the **SQL Editor** in the left sidebar.
3. Paste the contents of `backend/schema.sql` and run it. This creates the
   `users`, `friendships`, and `visited_locations` tables.
4. Go to **Project Settings → Database**. Under **Connection string**,
   copy the **URI** (it looks like
   `postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres`).
   Use the **Session pooler** connection string if you see one offered —
   it behaves better with Render's free tier. Save this string, you'll need
   it in the next step.

### Step 2.2 — Backend on Render

1. Go to [render.com](https://render.com) and sign up with GitHub.
2. Click **New → Web Service**, pick your repo, and set:
   - **Root directory:** `backend`
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
   - **Instance type:** Free
3. Under **Environment**, add these variables:
   - `DATABASE_URL` → the Supabase connection string from step 2.1
   - `JWT_SECRET` → any long random string (generate one locally with
     `openssl rand -hex 32`, or just mash the keyboard for 40+ characters)
   - `CORS_ORIGIN` → leave as `*` for now, you'll tighten this in step 2.4
   - `PORT` → `3001` (Render sets its own `PORT` automatically for some
     runtimes — if the service fails to bind, remove this variable and let
     Render inject its own `PORT`, since `server.js` reads `process.env.PORT`)
4. Deploy. Render will give you a URL like `https://waypoint-backend.onrender.com`.
5. Visit `https://waypoint-backend.onrender.com/api/health` — you should see
   `{"status":"ok"}`.

**Free tier note:** Render's free web services spin down after ~15 minutes
of inactivity and take 20-30 seconds to wake back up on the next request.
Fine for a hobby project with a few friends, just expect a slow first load.

### Step 2.3 — Frontend on Vercel

1. Before deploying, edit `frontend/config.js` and change:
   ```js
   const API_BASE_URL = "https://waypoint-backend.onrender.com/api";
   ```
   (your actual Render URL + `/api`), then commit and push.
2. Go to [vercel.com](https://vercel.com), sign up with GitHub, click
   **Add New → Project**, pick your repo.
3. Set **Root Directory** to `frontend`. Leave build settings blank/default
   (it's static files — no build command needed).
4. Deploy. Vercel gives you a URL like `https://waypoint-yourname.vercel.app`
   — this is the link you share with friends.

### Step 2.4 — Lock down CORS

Go back to Render → your backend service → Environment, and change
`CORS_ORIGIN` from `*` to your actual Vercel URL, e.g.:

```
CORS_ORIGIN=https://waypoint-yourname.vercel.app
```

Redeploy the backend. This means only your deployed frontend (not random
websites) can call your API — meaningfully reduces abuse risk for very
little effort.

---

## 3. Using the app

1. Open your Vercel URL, create an account.
2. Click anywhere on the map — it looks up the place name (via Nominatim)
   and shows a confirm panel. Add an optional note, click **Mark as
   visited**.
3. Add a friend by their username (they need an account first). They'll
   see a pending request and can accept it from their own logbook panel.
4. Once friends, check the box next to their name to overlay their pins
   (in teal) on your map.

---

## 4. Security notes (read before sharing the URL widely)

- Passwords are hashed with bcrypt — never stored in plain text.
- Auth uses JWTs valid for 30 days; there's no "forgot password" flow, so
  if someone forgets their password you'd need to reset it directly in the
  database for now.
- The free-tier setup above (Vercel + Render + Supabase) does **not**
  expose your own laptop to the internet at all — everything runs on the
  providers' infrastructure, so there's nothing on your machine to attack.
- This is a hobby-scale app: there's no rate limiting on login attempts and
  no email verification. Fine for a small friend group, not meant for a
  public audience.

---

## 5. Project structure

```
travel-map-app/
├── backend/
│   ├── server.js          # Express app entry point
│   ├── db.js               # Postgres connection pool
│   ├── schema.sql          # Run this once against your database
│   ├── middleware/auth.js  # JWT verification
│   ├── routes/auth.js      # register / login / me
│   ├── routes/locations.js # add / list / delete visited places
│   ├── routes/friends.js   # send / accept / list friend requests
│   ├── .env.example
│   └── Dockerfile
├── frontend/
│   ├── index.html
│   ├── style.css
│   ├── config.js           # <-- point this at your backend URL
│   └── app.js
├── docker-compose.yml
└── README.md
```
