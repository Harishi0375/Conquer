// ============================================================
// CONQUER frontend — vanilla JS, no build step required.
// API_BASE_URL comes from config.js
// ============================================================

const FRIEND_PALETTE = ['#4C8C86', '#7C5CBF', '#BF5C7C', '#5C8FBF', '#8FBF5C', '#BF8F5C', '#5CBFAE', '#BF5C5C'];

// Best-effort alias map: normalizes common country-name variants (as returned
// by Nominatim reverse geocoding) to the exact names used in the bundled
// world-countries.geo.json file, so the shading matches up. Anything not
// listed here is compared as-is (works for the large majority of countries).
const COUNTRY_ALIASES = {
  'united states': 'united states of america',
  'usa': 'united states of america',
  'russian federation': 'russia',
  'republic of korea': 'south korea',
  "korea, republic of": 'south korea',
  "democratic people's republic of korea": 'north korea',
  'czechia': 'czech republic',
  "côte d'ivoire": 'ivory coast',
  "cote d'ivoire": 'ivory coast',
  'tanzania': 'united republic of tanzania',
  'north macedonia': 'macedonia',
  'burma': 'myanmar',
  'eswatini': 'swaziland',
  'timor-leste': 'east timor',
  'congo-kinshasa': 'democratic republic of the congo',
  'dr congo': 'democratic republic of the congo',
  'congo-brazzaville': 'republic of the congo',
  'congo': 'republic of the congo',
  'uk': 'united kingdom',
};

function normalizeCountryKey(name) {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  return COUNTRY_ALIASES[key] || key;
}

let authToken = localStorage.getItem('conquer_token');
let currentUsername = localStorage.getItem('conquer_username');

let map;
let worldGeoData = null;

let ownMarkersById = {};   // location id -> Leaflet marker
let ownLocations = [];     // cached array of own location objects
let ownCountryLayer = null;
let ownCountryBounds = {}; // normalized country key -> Leaflet LatLngBounds

let friendState = {};      // friendId -> { username, color, markerLayer, countryLayer, loaded, visible }
let friendColorAssignments = {}; // friendId -> color, stable across re-renders

let pendingCoords = null;  // { lat, lng, label, city, country, street }

// ---------- API helper ----------
async function apiFetch(path, options = {}) {
  const headers = Object.assign(
    { 'Content-Type': 'application/json' },
    options.headers || {}
  );
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  let data = null;
  try { data = await res.json(); } catch (_) { /* no body */ }

  if (!res.ok) {
    const message = (data && data.error) || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

// ---------- Auth screen wiring ----------
const authScreen = document.getElementById('auth-screen');
const appShell = document.getElementById('app-shell');

document.querySelectorAll('.auth-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const isLogin = tab.dataset.tab === 'login';
    document.getElementById('login-form').classList.toggle('hidden', !isLogin);
    document.getElementById('register-form').classList.toggle('hidden', isLogin);
  });
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    completeLogin(data.token, data.user.username);
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value;
  const errorEl = document.getElementById('register-error');
  errorEl.textContent = '';
  try {
    const data = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    completeLogin(data.token, data.user.username);
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

function completeLogin(token, username) {
  authToken = token;
  currentUsername = username;
  localStorage.setItem('conquer_token', token);
  localStorage.setItem('conquer_username', username);
  enterApp();
}

document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.removeItem('conquer_token');
  localStorage.removeItem('conquer_username');
  window.location.reload();
});

// ---------- Boot ----------
async function boot() {
  if (!authToken) {
    authScreen.classList.remove('hidden');
    appShell.classList.add('hidden');
    return;
  }
  try {
    const data = await apiFetch('/auth/me');
    currentUsername = data.user.username;
    localStorage.setItem('conquer_username', currentUsername);
    enterApp();
  } catch (err) {
    localStorage.removeItem('conquer_token');
    localStorage.removeItem('conquer_username');
    authToken = null;
    authScreen.classList.remove('hidden');
    appShell.classList.add('hidden');
  }
}

async function enterApp() {
  authScreen.classList.add('hidden');
  appShell.classList.remove('hidden');
  document.getElementById('current-username').textContent = currentUsername;

  if (!map) initMap();

  await Promise.all([
    loadWorldGeoData(),
    loadOwnLocations(),
  ]);
  buildOwnCountryLayer();

  loadFriends();
  loadPendingRequests();
  loadLeaderboard();
}

// ---------- Map ----------
function initMap() {
  map = L.map('map', {
    worldCopyJump: true,           // infinite horizontal scroll, like Google Maps
    minZoom: 2,                    // can't zoom out past "whole world fits"
    maxBounds: L.latLngBounds(L.latLng(-85, -Infinity), L.latLng(85, Infinity)),
    maxBoundsViscosity: 1.0,       // solid "bounce back" at the poles instead of gray rectangle
    zoomControl: false,            // replaced below with a themed, repositioned one
  }).setView([20, 0], 2);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    minZoom: 2,
    maxZoom: 19,
    subdomains: 'abcd',
    detectRetina: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 120 }).addTo(map);

  map.on('click', onMapClick);
}

document.getElementById('reset-view-btn').addEventListener('click', () => {
  clearSearchHighlight();
  map.setView([20, 0], 2, { animate: true, duration: 1.2 });
});

function sealIcon(friendColor) {
  const style = friendColor ? ` style="--friend-color:${friendColor}"` : '';
  const cls = friendColor ? 'seal-marker friend-marker' : 'seal-marker';
  return L.divIcon({
    className: '',
    html: `<div class="${cls}"${style}></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
}

let searchHighlightMarker = null;

function showSearchHighlight(lat, lng) {
  clearSearchHighlight();
  searchHighlightMarker = L.marker([lat, lng], {
    icon: L.divIcon({
      className: '',
      html: '<div class="search-highlight-marker"><div class="search-highlight-ring"></div></div>',
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    }),
    interactive: false,
    zIndexOffset: 1000,
  }).addTo(map);
}

function clearSearchHighlight() {
  if (searchHighlightMarker) {
    map.removeLayer(searchHighlightMarker);
    searchHighlightMarker = null;
  }
}

// ---------- World country data & shading ----------
async function loadWorldGeoData() {
  if (worldGeoData) return;
  const res = await fetch('data/world-countries.geo.json');
  worldGeoData = await res.json();
}

function buildOwnCountryLayer() {
  if (!worldGeoData) return;
  const visitedKeys = new Set(ownLocations.map((l) => normalizeCountryKey(l.country)).filter(Boolean));

  if (ownCountryLayer) {
    map.removeLayer(ownCountryLayer);
  }

  ownCountryBounds = {};

  // interactive is always false here — country shading is purely visual now,
  // so clicking anywhere (even inside an already-claimed country) still opens
  // the "add a place" flow via the map's own click handler, instead of the
  // polygon swallowing the click to zoom in.
  ownCountryLayer = L.geoJSON(worldGeoData, {
    style: (feature) => {
      const key = (feature.properties.name || '').toLowerCase();
      const visited = visitedKeys.has(key);
      return visited
        ? { fillColor: '#D4A144', fillOpacity: 0.32, color: '#A87A22', weight: 1.5, interactive: false }
        : { fillColor: 'transparent', fillOpacity: 0, color: '#332C22', weight: 0.6, opacity: 0.6, interactive: false };
    },
    onEachFeature: (feature, layer) => {
      const key = (feature.properties.name || '').toLowerCase();
      if (visitedKeys.has(key)) {
        ownCountryBounds[key] = layer.getBounds();
      }
    },
  }).addTo(map);

  renderCountryChips();
}

function renderCountryChips() {
  const container = document.getElementById('country-chips');
  container.innerHTML = '';

  const seen = new Map(); // normalized key -> { label, count }
  ownLocations.forEach((loc) => {
    if (!loc.country) return;
    const key = normalizeCountryKey(loc.country);
    if (!seen.has(key)) seen.set(key, { label: loc.country, count: 0 });
    seen.get(key).count += 1;
  });

  if (seen.size === 0) return;

  seen.forEach(({ label, count }, key) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'country-chip';
    chip.textContent = `${label} (${count})`;
    chip.addEventListener('click', () => {
      clearSearchHighlight();
      const bounds = ownCountryBounds[key];
      if (bounds) {
        map.fitBounds(bounds, { padding: [40, 40], animate: true, duration: 1 });
      }
    });
    container.appendChild(chip);
  });
}

function friendCountryStyleFactory(color, visitedKeys) {
  return (feature) => {
    const key = (feature.properties.name || '').toLowerCase();
    const visited = visitedKeys.has(key);
    return visited
      ? { fillColor: color, fillOpacity: 0.2, color, weight: 1, dashArray: '3 3', interactive: false }
      : { fillColor: 'transparent', fillOpacity: 0, weight: 0, interactive: false };
  };
}

async function onMapClick(e) {
  clearSearchHighlight();
  const { lat, lng } = e.latlng;
  const pendingPanel = document.getElementById('pending-pin');
  const label = document.getElementById('pending-pin-label');
  const dateInput = document.getElementById('pin-date');

  pendingPanel.classList.remove('hidden');
  label.textContent = 'Looking up this place…';
  dateInput.value = new Date().toISOString().slice(0, 10);
  pendingCoords = { lat, lng, label: '', city: null, country: null, street: null };

  try {
    // Nominatim reverse geocoding — free, no API key. Please keep click
    // frequency reasonable (their usage policy asks for ~1 request/sec).
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`;
    const res = await fetch(url);
    const data = await res.json();
    const addr = data.address || {};

    const city = addr.city || addr.town || addr.village || addr.municipality || null;
    const country = addr.country || null;
    const street = addr.road || null;

    const parts = [street, city, country].filter(Boolean);
    const displayLabel = parts.length ? parts.join(', ') : `${lat.toFixed(3)}, ${lng.toFixed(3)}`;

    pendingCoords = { lat, lng, label: displayLabel, city, country, street };
    label.textContent = displayLabel;
  } catch (err) {
    const fallback = `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
    pendingCoords = { lat, lng, label: fallback, city: null, country: null, street: null };
    label.textContent = `${fallback} (couldn't look up the name)`;
  }
}

document.getElementById('cancel-pin-btn').addEventListener('click', () => {
  clearSearchHighlight();
  pendingCoords = null;
  document.getElementById('pending-pin').classList.add('hidden');
  document.getElementById('pin-note').value = '';
});

document.getElementById('confirm-pin-btn').addEventListener('click', async () => {
  if (!pendingCoords) return;
  const note = document.getElementById('pin-note').value.trim();
  const visitedAt = document.getElementById('pin-date').value || null;
  const tripName = document.getElementById('pin-trip-name').value.trim() || null;
  const photoFiles = Array.from(document.getElementById('pin-photo').files || []);

  try {
    const photos = await Promise.all(photoFiles.map((f) => compressImageToTarget(f)));

    const data = await apiFetch('/locations', {
      method: 'POST',
      body: JSON.stringify({
        lat: pendingCoords.lat,
        lng: pendingCoords.lng,
        label: note || null,
        city: pendingCoords.city,
        country: pendingCoords.country,
        street: pendingCoords.street,
        visited_at: visitedAt,
        trip_name: tripName,
        photos,
      }),
    });
    addOwnLocationToState(data.location);
    document.getElementById('pending-pin').classList.add('hidden');
    document.getElementById('pin-note').value = '';
    document.getElementById('pin-trip-name').value = '';
    document.getElementById('pin-photo').value = '';
    pendingCoords = null;
    clearSearchHighlight();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Own locations ----------
async function loadOwnLocations() {
  const data = await apiFetch('/locations');
  ownLocations = data.locations;
  Object.values(ownMarkersById).forEach((m) => map.removeLayer(m));
  ownMarkersById = {};
  ownLocations.forEach((loc) => addOwnLocationToMap(loc));
  renderOwnLocationsList();
  renderCountryChips();
  renderAchievements();
  updateStats();
}

function addOwnLocationToState(loc) {
  ownLocations.unshift(loc);
  addOwnLocationToMap(loc);
  renderOwnLocationsList();
  renderAchievements();
  updateStats();
  buildOwnCountryLayer(); // rebuilds bounds + chips together
  loadLeaderboard();
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  // The API returns DATE columns as full ISO timestamps (e.g. "2019-06-15T00:00:00.000Z"),
  // so we parse directly rather than assuming a bare "YYYY-MM-DD" string.
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function buildPhotoListHtml(photos) {
  if (!photos || photos.length === 0) return '';
  return `<div class="popup-photo-list">${photos.map((p) => `<img src="${p}" class="popup-photo-list-item" alt="" />`).join('')}</div>`;
}

// Hover over a marker with photos: cycle through them in a small floating
// tooltip. Click the marker: open the full popup with every photo listed.
function attachPhotoHover(marker, photos) {
  if (!photos || photos.length === 0) return;

  let idx = 0;
  let intervalId = null;
  marker.bindTooltip('', { direction: 'top', offset: [0, -14], opacity: 0.95, className: 'photo-hover-tooltip', sticky: false });

  marker.on('mouseover', () => {
    idx = 0;
    marker.setTooltipContent(`<img src="${photos[idx]}" class="hover-photo" alt="" />`);
    marker.openTooltip();
    if (photos.length > 1) {
      intervalId = setInterval(() => {
        idx = (idx + 1) % photos.length;
        marker.setTooltipContent(`<img src="${photos[idx]}" class="hover-photo" alt="" />`);
      }, 900);
    }
  });
  marker.on('mouseout', () => {
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
    marker.closeTooltip();
  });
}

function addOwnLocationToMap(loc) {
  const marker = L.marker([loc.lat, loc.lng], { icon: sealIcon(null) }).addTo(map);
  const title = [loc.street, loc.city, loc.country].filter(Boolean).join(', ') || `${loc.lat.toFixed(3)}, ${loc.lng.toFixed(3)}`;
  const dateStr = formatDate(loc.visited_at);
  const metaParts = [dateStr, loc.trip_name, loc.label].filter(Boolean);
  marker.bindPopup(
    buildPhotoListHtml(loc.photos) +
    `<p class="popup-title">${escapeHtml(title)}</p>` +
    (metaParts.length ? `<p class="popup-meta">${escapeHtml(metaParts.join(' — '))}</p>` : '')
  );
  attachPhotoHover(marker, loc.photos);
  ownMarkersById[loc.id] = marker;
}

function renderOwnLocationsList() {
  const list = document.getElementById('own-locations-list');
  list.innerHTML = '';
  if (ownLocations.length === 0) {
    list.innerHTML = '<li class="empty-note">Nothing claimed yet — click the map to start.</li>';
    return;
  }

  // Timeline order: most recently visited first (falls back to when it was added).
  const sorted = [...ownLocations].sort((a, b) => {
    const da = new Date(a.visited_at || a.created_at).getTime();
    const db = new Date(b.visited_at || b.created_at).getTime();
    return db - da;
  });

  const groups = new Map(); // trip name (or null for ungrouped) -> locations
  sorted.forEach((loc) => {
    const key = loc.trip_name || null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(loc);
  });

  groups.forEach((locs, tripName) => {
    if (tripName) {
      const header = document.createElement('li');
      header.className = 'trip-group-header';
      header.textContent = tripName;
      list.appendChild(header);
    }
    locs.forEach((loc) => {
      const li = document.createElement('li');
      const title = [loc.city, loc.country].filter(Boolean).join(', ') || `${loc.lat.toFixed(2)}, ${loc.lng.toFixed(2)}`;
      const dateStr = formatDate(loc.visited_at);
      const metaParts = [dateStr, loc.label].filter(Boolean);
      const thumbHtml = loc.photos && loc.photos[0] ? `<img src="${loc.photos[0]}" class="loc-thumb" alt="" />` : '';
      li.innerHTML = `
        ${thumbHtml}
        <div class="loc-main">
          <span class="loc-place">${escapeHtml(title)}</span>
          ${metaParts.length ? `<span class="loc-meta">${escapeHtml(metaParts.join(' — '))}</span>` : ''}
        </div>
        <button class="loc-delete" data-id="${loc.id}" title="Remove">✕</button>
      `;
      list.appendChild(li);
    });
  });

  list.querySelectorAll('.loc-delete').forEach((btn) => {
    btn.addEventListener('click', () => deleteOwnLocation(parseInt(btn.dataset.id, 10)));
  });
}

async function deleteOwnLocation(id) {
  try {
    await apiFetch(`/locations/${id}`, { method: 'DELETE' });
    if (ownMarkersById[id]) {
      map.removeLayer(ownMarkersById[id]);
      delete ownMarkersById[id];
    }
    ownLocations = ownLocations.filter((l) => l.id !== id);
    renderOwnLocationsList();
    renderAchievements();
    updateStats();
    buildOwnCountryLayer(); // rebuilds bounds + chips together
    loadLeaderboard();
  } catch (err) {
    alert(err.message);
  }
}

function updateStats() {
  const countries = new Set(ownLocations.map((l) => l.country).filter(Boolean));
  const cities = new Set(ownLocations.map((l) => l.city).filter(Boolean));
  document.getElementById('stat-countries').textContent = countries.size;
  document.getElementById('stat-cities').textContent = cities.size;
}

// ---------- Friends ----------
document.getElementById('add-friend-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('friend-username-input');
  const note = document.getElementById('friend-request-note');
  const username = input.value.trim();
  note.textContent = '';
  note.classList.remove('error');

  try {
    await apiFetch('/friends/request', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
    note.textContent = `Request sent to ${username}.`;
    input.value = '';
  } catch (err) {
    note.textContent = err.message;
    note.classList.add('error');
  }
});

async function loadPendingRequests() {
  try {
    const data = await apiFetch('/friends/pending');
    const container = document.getElementById('pending-requests');
    container.innerHTML = '';
    data.pending.forEach((req) => {
      const div = document.createElement('div');
      div.className = 'pending-request-item';
      div.innerHTML = `
        <span>${escapeHtml(req.username)} wants to connect</span>
        <span class="req-actions">
          <button class="btn-secondary small" data-accept="${req.request_id}">Accept</button>
          <button class="btn-ghost small" data-decline="${req.request_id}">Decline</button>
        </span>
      `;
      container.appendChild(div);
    });

    container.querySelectorAll('[data-accept]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await apiFetch(`/friends/accept/${btn.dataset.accept}`, { method: 'POST' });
          loadPendingRequests();
          loadFriends();
        } catch (err) { alert(err.message); }
      });
    });
    container.querySelectorAll('[data-decline]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await apiFetch(`/friends/${btn.dataset.decline}`, { method: 'DELETE' });
          loadPendingRequests();
        } catch (err) { alert(err.message); }
      });
    });
  } catch (err) {
    console.error('Failed to load pending requests', err);
  }
}

function colorForFriend(friendId) {
  if (!friendColorAssignments[friendId]) {
    const usedCount = Object.keys(friendColorAssignments).length;
    friendColorAssignments[friendId] = FRIEND_PALETTE[usedCount % FRIEND_PALETTE.length];
  }
  return friendColorAssignments[friendId];
}

async function loadFriends() {
  try {
    const data = await apiFetch('/friends');
    const list = document.getElementById('friends-list');
    list.innerHTML = '';

    if (data.friends.length === 0) {
      list.innerHTML = '<li class="empty-note">No allies yet — add one by username above.</li>';
      return;
    }

    data.friends.forEach((f) => {
      const color = colorForFriend(f.user_id);
      if (!friendState[f.user_id]) {
        friendState[f.user_id] = {
          username: f.username,
          friendshipId: f.friendship_id,
          color,
          markerLayer: L.layerGroup(),
          countryLayer: null,
          loaded: false,
          visible: false,
        };
      }

      const li = document.createElement('li');
      li.innerHTML = `
        <label class="friend-toggle">
          <input type="checkbox" data-friend-id="${f.user_id}" />
          <span class="friend-color-dot" style="background:${color}"></span>
          <span class="friend-username">${escapeHtml(f.username)}</span>
        </label>
        <button class="friend-remove" data-remove="${f.friendship_id}" title="Remove ally">✕</button>
      `;
      list.appendChild(li);
    });

    list.querySelectorAll('[data-friend-id]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => toggleFriendOverlay(parseInt(checkbox.dataset.friendId, 10), checkbox.checked));
    });
    list.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this ally?')) return;
        try {
          await apiFetch(`/friends/${btn.dataset.remove}`, { method: 'DELETE' });
          loadFriends();
        } catch (err) { alert(err.message); }
      });
    });
  } catch (err) {
    console.error('Failed to load friends', err);
  }
}

async function toggleFriendOverlay(friendId, visible) {
  const state = friendState[friendId];
  if (!state) return;

  if (visible && !state.loaded) {
    try {
      const data = await apiFetch(`/locations/friend/${friendId}`);
      const visitedKeys = new Set();

      data.locations.forEach((loc) => {
        if (loc.country) visitedKeys.add(normalizeCountryKey(loc.country));

        const marker = L.marker([loc.lat, loc.lng], { icon: sealIcon(state.color) });
        const title = [loc.street, loc.city, loc.country].filter(Boolean).join(', ') || `${loc.lat.toFixed(3)}, ${loc.lng.toFixed(3)}`;
        const dateStr = formatDate(loc.visited_at);
        const metaParts = [state.username, dateStr, loc.label].filter(Boolean);
        marker.bindPopup(
          buildPhotoListHtml(loc.photos) +
          `<p class="popup-title">${escapeHtml(title)}</p>` +
          `<p class="popup-meta">${escapeHtml(metaParts.join(' — '))}</p>`
        );
        attachPhotoHover(marker, loc.photos);
        state.markerLayer.addLayer(marker);
      });

      if (worldGeoData) {
        state.countryLayer = L.geoJSON(worldGeoData, {
          style: friendCountryStyleFactory(state.color, visitedKeys),
        });
      }

      state.loaded = true;
    } catch (err) {
      alert(err.message);
      return;
    }
  }

  state.visible = visible;
  if (visible) {
    state.markerLayer.addTo(map);
    if (state.countryLayer) state.countryLayer.addTo(map);
  } else {
    map.removeLayer(state.markerLayer);
    if (state.countryLayer) map.removeLayer(state.countryLayer);
  }
}

// ---------- Search (jump to a city or country) ----------
document.getElementById('search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('search-input');
  const query = input.value.trim();
  const resultsList = document.getElementById('search-results');
  if (!query) return;

  resultsList.classList.remove('hidden');
  resultsList.innerHTML = '<li class="empty-note">Searching…</li>';

  try {
    // Nominatim forward geocoding (place name -> coordinates), English results.
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&accept-language=en&addressdetails=1&limit=5`;
    const res = await fetch(url);
    const places = await res.json();

    if (!places.length) {
      resultsList.innerHTML = '<li class="empty-note">No results found.</li>';
      return;
    }

    resultsList.innerHTML = '';
    places.forEach((place) => {
      const li = document.createElement('li');
      li.className = 'search-result-item';
      li.textContent = place.display_name;
      li.addEventListener('click', () => {
        const lat = parseFloat(place.lat);
        const lon = parseFloat(place.lon);
        const zoom = place.type === 'country' ? 5 : place.class === 'boundary' ? 8 : 12;
        map.flyTo([lat, lon], zoom, { animate: true, duration: 1.2 });
        showSearchHighlight(lat, lon);

        // Pre-fill the claim panel straight from the search result — no need
        // for a second reverse-geocode round trip, and no need to click again.
        const addr = place.address || {};
        const city = addr.city || addr.town || addr.village || addr.municipality || null;
        const country = addr.country || null;
        const street = addr.road || null;
        const parts = [street, city, country].filter(Boolean);
        const displayLabel = parts.length ? parts.join(', ') : place.display_name;

        pendingCoords = { lat, lng: lon, label: displayLabel, city, country, street };
        document.getElementById('pin-date').value = new Date().toISOString().slice(0, 10);
        document.getElementById('pending-pin-label').textContent = displayLabel;
        document.getElementById('pending-pin').classList.remove('hidden');

        resultsList.classList.add('hidden');
        resultsList.innerHTML = '';
        input.value = '';
      });
      resultsList.appendChild(li);
    });
  } catch (err) {
    resultsList.innerHTML = '<li class="empty-note">Search failed — try again.</li>';
  }
});

// ---------- Trip memory: photo compression ----------
function compressImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height *= maxDim / width; width = maxDim; }
        else if (height >= width && height > maxDim) { width *= maxDim / height; height = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// Compresses toward ~100KB: tries shrinking quality first, then dimensions,
// stopping once under target or after a handful of attempts either way.
async function compressImageToTarget(file, targetBytes = 100 * 1024) {
  const approxBytes = (dataUrl) => Math.ceil((dataUrl.length * 3) / 4);

  let dim = 800;
  let quality = 0.7;
  let dataUrl = await compressImage(file, dim, quality);

  let attempts = 0;
  while (approxBytes(dataUrl) > targetBytes && attempts < 5) {
    quality = Math.max(0.3, quality - 0.1);
    dataUrl = await compressImage(file, dim, quality);
    attempts++;
  }
  while (approxBytes(dataUrl) > targetBytes && dim > 300 && attempts < 10) {
    dim -= 150;
    dataUrl = await compressImage(file, dim, quality);
    attempts++;
  }
  return dataUrl;
}

// ---------- Gamification: achievements ----------
const ACHIEVEMENTS = [
  { id: 'first_claim', label: 'First Claim', icon: '🚩', test: (s) => s.pins >= 1 },
  { id: 'city_hopper', label: 'City Hopper', icon: '🏙️', test: (s) => s.cities >= 5 },
  { id: 'well_traveled', label: 'Well Traveled', icon: '🧳', test: (s) => s.cities >= 10 },
  { id: 'globetrotter', label: 'Globetrotter', icon: '🌍', test: (s) => s.countries >= 5 },
  { id: 'world_conqueror', label: 'World Conqueror', icon: '👑', test: (s) => s.countries >= 15 },
];

function renderAchievements() {
  const countries = new Set(ownLocations.map((l) => l.country).filter(Boolean)).size;
  const cities = new Set(ownLocations.map((l) => l.city).filter(Boolean)).size;
  const stats = { pins: ownLocations.length, countries, cities };

  const grid = document.getElementById('achievements-grid');
  grid.innerHTML = '';
  ACHIEVEMENTS.forEach((a) => {
    const earned = a.test(stats);
    const div = document.createElement('div');
    div.className = `achievement-badge${earned ? ' earned' : ''}`;
    div.title = a.label;
    div.innerHTML = `<span class="achievement-icon">${a.icon}</span><span class="achievement-label">${a.label}</span>`;
    grid.appendChild(div);
  });
}

// ---------- Gamification: leaderboard ----------
async function loadLeaderboard() {
  try {
    const data = await apiFetch('/friends/leaderboard');
    const list = document.getElementById('leaderboard-list');
    list.innerHTML = '';
    const medals = ['🥇', '🥈', '🥉'];
    data.leaderboard.forEach((row, i) => {
      const li = document.createElement('li');
      const isMe = row.username === currentUsername;
      li.className = isMe ? 'leaderboard-item me' : 'leaderboard-item';
      li.innerHTML = `
        <span class="leaderboard-rank">${medals[i] || i + 1}</span>
        <span class="leaderboard-name">${escapeHtml(row.username)}${isMe ? ' (you)' : ''}</span>
        <span class="leaderboard-score">${row.countries} countries · ${row.cities} cities</span>
      `;
      list.appendChild(li);
    });
  } catch (err) {
    console.error('Failed to load leaderboard', err);
  }
}

// ---------- Utility ----------
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

boot();