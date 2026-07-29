// ============================================================
// Waypoint frontend — vanilla JS, no build step required.
// API_BASE_URL comes from config.js
// ============================================================

const FRIEND_COLOR = '#4C8C86';

let authToken = localStorage.getItem('waypoint_token');
let currentUsername = localStorage.getItem('waypoint_username');

let map;
let ownMarkersById = {};   // location id -> Leaflet marker
let ownLocations = [];     // cached array of own location objects
let friendState = {};      // friendId -> { username, layerGroup, loaded, visible }
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
  localStorage.setItem('waypoint_token', token);
  localStorage.setItem('waypoint_username', username);
  enterApp();
}

document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.removeItem('waypoint_token');
  localStorage.removeItem('waypoint_username');
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
    localStorage.setItem('waypoint_username', currentUsername);
    enterApp();
  } catch (err) {
    // token invalid/expired
    localStorage.removeItem('waypoint_token');
    localStorage.removeItem('waypoint_username');
    authToken = null;
    authScreen.classList.remove('hidden');
    appShell.classList.add('hidden');
  }
}

function enterApp() {
  authScreen.classList.add('hidden');
  appShell.classList.remove('hidden');
  document.getElementById('current-username').textContent = currentUsername;

  if (!map) initMap();
  loadOwnLocations();
  loadFriends();
  loadPendingRequests();
}

// ---------- Map ----------
function initMap() {
  map = L.map('map', { worldCopyJump: true }).setView([20, 0], 2);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  map.on('click', onMapClick);
}

function stampIcon(isFriend) {
  return L.divIcon({
    className: '',
    html: `<div class="stamp-marker${isFriend ? ' friend-marker' : ''}"></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -13],
  });
}

async function onMapClick(e) {
  const { lat, lng } = e.latlng;
  const pendingPanel = document.getElementById('pending-pin');
  const label = document.getElementById('pending-pin-label');

  pendingPanel.classList.remove('hidden');
  label.textContent = 'Looking up this place…';
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
  pendingCoords = null;
  document.getElementById('pending-pin').classList.add('hidden');
  document.getElementById('pin-note').value = '';
});

document.getElementById('confirm-pin-btn').addEventListener('click', async () => {
  if (!pendingCoords) return;
  const note = document.getElementById('pin-note').value.trim();

  try {
    const data = await apiFetch('/locations', {
      method: 'POST',
      body: JSON.stringify({
        lat: pendingCoords.lat,
        lng: pendingCoords.lng,
        label: note || null,
        city: pendingCoords.city,
        country: pendingCoords.country,
        street: pendingCoords.street,
        visited_at: new Date().toISOString().slice(0, 10),
      }),
    });
    addOwnLocationToState(data.location);
    document.getElementById('pending-pin').classList.add('hidden');
    document.getElementById('pin-note').value = '';
    pendingCoords = null;
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Own locations ----------
async function loadOwnLocations() {
  try {
    const data = await apiFetch('/locations');
    ownLocations = data.locations;
    Object.values(ownMarkersById).forEach((m) => map.removeLayer(m));
    ownMarkersById = {};
    ownLocations.forEach((loc) => addOwnLocationToMap(loc));
    renderOwnLocationsList();
    updateStats();
  } catch (err) {
    console.error('Failed to load locations', err);
  }
}

function addOwnLocationToState(loc) {
  ownLocations.unshift(loc);
  addOwnLocationToMap(loc);
  renderOwnLocationsList();
  updateStats();
}

function addOwnLocationToMap(loc) {
  const marker = L.marker([loc.lat, loc.lng], { icon: stampIcon(false) }).addTo(map);
  const title = [loc.street, loc.city, loc.country].filter(Boolean).join(', ') || `${loc.lat.toFixed(3)}, ${loc.lng.toFixed(3)}`;
  marker.bindPopup(
    `<p class="popup-title">${escapeHtml(title)}</p>` +
    (loc.label ? `<p class="popup-note">${escapeHtml(loc.label)}</p>` : '')
  );
  ownMarkersById[loc.id] = marker;
}

function renderOwnLocationsList() {
  const list = document.getElementById('own-locations-list');
  list.innerHTML = '';
  if (ownLocations.length === 0) {
    list.innerHTML = '<li class="empty-note">Nothing logged yet — click the map to start.</li>';
    return;
  }
  ownLocations.forEach((loc) => {
    const li = document.createElement('li');
    const title = [loc.city, loc.country].filter(Boolean).join(', ') || `${loc.lat.toFixed(2)}, ${loc.lng.toFixed(2)}`;
    li.innerHTML = `
      <div class="loc-main">
        <span class="loc-place">${escapeHtml(title)}</span>
        ${loc.label ? `<span class="loc-note">${escapeHtml(loc.label)}</span>` : ''}
      </div>
      <button class="loc-delete" data-id="${loc.id}" title="Remove">✕</button>
    `;
    list.appendChild(li);
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
    updateStats();
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
    note.textContent = `Friend request sent to ${username}.`;
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

async function loadFriends() {
  try {
    const data = await apiFetch('/friends');
    const list = document.getElementById('friends-list');
    list.innerHTML = '';

    if (data.friends.length === 0) {
      list.innerHTML = '<li class="empty-note">No friends yet — add one by username above.</li>';
      return;
    }

    data.friends.forEach((f) => {
      if (!friendState[f.user_id]) {
        friendState[f.user_id] = {
          username: f.username,
          friendshipId: f.friendship_id,
          layerGroup: L.layerGroup(),
          loaded: false,
          visible: false,
        };
      }

      const li = document.createElement('li');
      li.innerHTML = `
        <label class="friend-toggle">
          <input type="checkbox" data-friend-id="${f.user_id}" />
          <span class="friend-color-dot" style="background:${FRIEND_COLOR}"></span>
          ${escapeHtml(f.username)}
        </label>
        <button class="friend-remove" data-remove="${f.friendship_id}" title="Remove friend">✕</button>
      `;
      list.appendChild(li);
    });

    list.querySelectorAll('[data-friend-id]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => toggleFriendOverlay(parseInt(checkbox.dataset.friendId, 10), checkbox.checked));
    });
    list.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this friend?')) return;
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
      data.locations.forEach((loc) => {
        const marker = L.marker([loc.lat, loc.lng], { icon: stampIcon(true) });
        const title = [loc.street, loc.city, loc.country].filter(Boolean).join(', ') || `${loc.lat.toFixed(3)}, ${loc.lng.toFixed(3)}`;
        marker.bindPopup(
          `<p class="popup-title">${escapeHtml(title)}</p>` +
          `<p class="popup-note">${escapeHtml(state.username)}${loc.label ? ' — ' + escapeHtml(loc.label) : ''}</p>`
        );
        state.layerGroup.addLayer(marker);
      });
      state.loaded = true;
    } catch (err) {
      alert(err.message);
      return;
    }
  }

  state.visible = visible;
  if (visible) {
    state.layerGroup.addTo(map);
  } else {
    map.removeLayer(state.layerGroup);
  }
}

// ---------- Utility ----------
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

boot();
