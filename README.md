# CONQUER

Claim every place you've stood on.

CONQUER is a personal travel map. Click anywhere in the world to log a visit — a country gets shaded in gold the moment you've claimed a spot inside it, cities and streets get tracked underneath, and you can attach the date you were actually there. Add friends by username and toggle their territory on top of yours, each one shown in its own color.

**Live at:** https://conquer-nu-five.vercel.app

## What it does

- **Claim a place** — click the map, CONQUER looks up the city/country/street automatically, you add an optional note and the date you visited.
- **Territory view** — your conquered countries are shaded gold on the world map from the moment you log in. Click a shaded country to zoom into exactly what you've claimed there.
- **Allies** — add friends by username, accept/decline requests, and see their claimed territory overlaid in a color assigned to them automatically.
- **Your log** — every place you've claimed, with its date and note, listed and editable from the sidebar.

## How it's built

- **Frontend:** plain HTML/CSS/JS + [Leaflet.js](https://leafletjs.com/) for the map, no framework or build step.
- **Backend:** Node.js + Express, JWT-based auth, PostgreSQL.
- **Place lookup:** [Nominatim](https://nominatim.org/) (OpenStreetMap) — free reverse geocoding, no API key.
- **Territory shading:** a bundled world country boundary file, matched against whatever country name each visit resolves to.

## Running it yourself

```bash
git clone <this-repo>
cd travel-map-app
docker compose up --build
```

Open **http://localhost:8080**. That's it — Postgres, the API, and the frontend all start together.

## Project layout

```
travel-map-app/
├── backend/     # Express API, auth, and the Postgres schema
├── frontend/    # the map, sidebar, and all client-side logic
└── docker-compose.yml
```