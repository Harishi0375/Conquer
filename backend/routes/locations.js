const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// Add a visited location for the logged-in user
router.post('/', async (req, res) => {
  const { lat, lng, label, city, country, street, visited_at } = req.body || {};

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat and lng must be numbers.' });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'lat/lng out of range.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO visited_locations (user_id, lat, lng, label, city, country, street, visited_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, lat, lng, label, city, country, street, visited_at, created_at`,
      [req.userId, lat, lng, label || null, city || null, country || null, street || null, visited_at || null]
    );
    res.status(201).json({ location: result.rows[0] });
  } catch (err) {
    console.error('Add location error:', err);
    res.status(500).json({ error: 'Could not save location.' });
  }
});

// List the logged-in user's own visited locations
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, lat, lng, label, city, country, street, visited_at, created_at FROM visited_locations WHERE user_id = $1 ORDER BY created_at DESC',
      [req.userId]
    );
    res.json({ locations: result.rows });
  } catch (err) {
    console.error('List locations error:', err);
    res.status(500).json({ error: 'Could not fetch locations.' });
  }
});

// Delete one of your own locations
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
      'SELECT id, lat, lng, label, city, country, street, visited_at FROM visited_locations WHERE user_id = $1 ORDER BY created_at DESC',
      [friendId]
    );
    res.json({ locations: result.rows });
  } catch (err) {
    console.error('Friend locations error:', err);
    res.status(500).json({ error: 'Could not fetch friend locations.' });
  }
});

module.exports = router;
