const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// Send a friend request by username
router.post('/request', async (req, res) => {
  const { username } = req.body || {};
  if (!username) {
    return res.status(400).json({ error: 'Username is required.' });
  }

  try {
    const targetResult = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    const target = targetResult.rows[0];
    if (!target) {
      return res.status(404).json({ error: 'No user with that username.' });
    }
    if (target.id === req.userId) {
      return res.status(400).json({ error: "You can't friend yourself." });
    }

    // Check for an existing friendship/request in either direction
    const existing = await pool.query(
      `SELECT id, status, requester_id FROM friendships
       WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
      [req.userId, target.id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'A friend request or friendship already exists with this user.' });
    }

    const result = await pool.query(
      `INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'pending')
       RETURNING id, requester_id, addressee_id, status, created_at`,
      [req.userId, target.id]
    );
    res.status(201).json({ request: result.rows[0] });
  } catch (err) {
    console.error('Friend request error:', err);
    res.status(500).json({ error: 'Could not send friend request.' });
  }
});

// Accept an incoming friend request
router.post('/accept/:requestId', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE friendships SET status = 'accepted'
       WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
       RETURNING id, requester_id, addressee_id, status`,
      [req.params.requestId, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found.' });
    }
    res.json({ friendship: result.rows[0] });
  } catch (err) {
    console.error('Accept friend error:', err);
    res.status(500).json({ error: 'Could not accept request.' });
  }
});

// Decline an incoming request, or remove an existing friendship
router.delete('/:requestId', async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM friendships
       WHERE id = $1 AND (requester_id = $2 OR addressee_id = $2)
       RETURNING id`,
      [req.params.requestId, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Request or friendship not found.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Remove friend error:', err);
    res.status(500).json({ error: 'Could not remove.' });
  }
});

// List accepted friends
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.id AS friendship_id, u.id AS user_id, u.username
       FROM friendships f
       JOIN users u ON u.id = (CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END)
       WHERE f.status = 'accepted' AND (f.requester_id = $1 OR f.addressee_id = $1)
       ORDER BY u.username`,
      [req.userId]
    );
    res.json({ friends: result.rows });
  } catch (err) {
    console.error('List friends error:', err);
    res.status(500).json({ error: 'Could not fetch friends.' });
  }
});

// List incoming pending requests (people who friend-requested you)
router.get('/pending', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.id AS request_id, u.id AS user_id, u.username, f.created_at
       FROM friendships f
       JOIN users u ON u.id = f.requester_id
       WHERE f.status = 'pending' AND f.addressee_id = $1
       ORDER BY f.created_at DESC`,
      [req.userId]
    );
    res.json({ pending: result.rows });
  } catch (err) {
    console.error('Pending requests error:', err);
    res.status(500).json({ error: 'Could not fetch pending requests.' });
  }
});

// Leaderboard: you + all accepted friends, ranked by countries then cities
router.get('/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username,
              COUNT(DISTINCT vl.country) FILTER (WHERE vl.country IS NOT NULL) AS countries,
              COUNT(DISTINCT vl.city) FILTER (WHERE vl.city IS NOT NULL) AS cities
       FROM users u
       LEFT JOIN visited_locations vl ON vl.user_id = u.id
       WHERE u.id = $1
          OR u.id IN (
            SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END
            FROM friendships WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1)
          )
       GROUP BY u.id, u.username
       ORDER BY countries DESC, cities DESC, u.username ASC`,
      [req.userId]
    );
    res.json({ leaderboard: result.rows });
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Could not load leaderboard.' });
  }
});

module.exports = router;
