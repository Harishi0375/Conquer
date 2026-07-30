const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// Attach a photos[] array to each location, in one extra query instead of N+1.
async function attachPhotos(locations) {
  const ids = locations.map((l) => l.id);
  if (ids.length === 0) return locations.map((l) => ({ ...l, photos: [] }));

  const photoResult = await pool.query(
    'SELECT location_id, photo FROM location_photos WHERE location_id = ANY($1) ORDER BY id ASC',
    [ids]
  );
  const byLocation = {};
  photoResult.rows.forEach((r) => {
    if (!byLocation[r.location_id]) byLocation[r.location_id] = [];
    byLocation[r.location_id].push(r.photo);
  });
  return locations.map((l) => ({ ...l, photos: byLocation[l.id] || [] }));
}

// Add a visited location for the logged-in user
router.post('/', async (req, res) => {
  const { lat, lng, label, city, country, street, visited_at, trip_name, photos } = req.body || {};

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat and lng must be numbers.' });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'lat/lng out of range.' });
  }
  if (photos !== undefined && !Array.isArray(photos)) {
    return res.status(400).json({ error: 'photos must be an array of image data.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO visited_locations (user_id, lat, lng, label, city, country, street, visited_at, trip_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, lat, lng, label, city, country, street, visited_at, trip_name, created_at`,
      [req.userId, lat, lng, label || null, city || null, country || null, street || null, visited_at || null, trip_name || null]
    );
    const location = result.rows[0];

    let savedPhotos = [];
    if (Array.isArray(photos) && photos.length > 0) {
      const values = [];
      const placeholders = photos
        .map((p) => {
          values.push(location.id, p);
          return `($${values.length - 1}, $${values.length})`;
        })
        .join(', ');
      const photoResult = await pool.query(
        `INSERT INTO location_photos (location_id, photo) VALUES ${placeholders} RETURNING photo`,
        values
      );
      savedPhotos = photoResult.rows.map((r) => r.photo);
    }

    res.status(201).json({ location: { ...location, photos: savedPhotos } });
  } catch (err) {
    console.error('Add location error:', err);
    res.status(500).json({ error: 'Could not save location.' });
  }
});

// List the logged-in user's own visited locations
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, lat, lng, label, city, country, street, visited_at, trip_name, created_at FROM visited_locations WHERE user_id = $1 ORDER BY created_at DESC',
      [req.userId]
    );
    const withPhotos = await attachPhotos(result.rows);
    res.json({ locations: withPhotos });
  } catch (err) {
    console.error('List locations error:', err);
    res.status(500).json({ error: 'Could not fetch locations.' });
  }
});

// Delete one of your own locations (its photos cascade-delete automatically)
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM visited_locations WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Location not found.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Delete location error:', err);
    res.status(500).json({ error: 'Could not delete location.' });
  }
});

// List a friend's visited locations — only if you're actually friends
router.get('/friend/:friendId', async (req, res) => {
  const friendId = parseInt(req.params.friendId, 10);
  if (Number.isNaN(friendId)) {
    return res.status(400).json({ error: 'Invalid friend id.' });
  }

  try {
    const friendship = await pool.query(
      `SELECT id FROM friendships
       WHERE status = 'accepted'
       AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
      [req.userId, friendId]
    );
    if (friendship.rows.length === 0) {
      return res.status(403).json({ error: 'You are not friends with this user.' });
    }

    const result = await pool.query(
      'SELECT id, lat, lng, label, city, country, street, visited_at, trip_name FROM visited_locations WHERE user_id = $1 ORDER BY created_at DESC',
      [friendId]
    );
    const withPhotos = await attachPhotos(result.rows);
    res.json({ locations: withPhotos });
  } catch (err) {
    console.error('Friend locations error:', err);
    res.status(500).json({ error: 'Could not fetch friend locations.' });
  }
});

module.exports = router;