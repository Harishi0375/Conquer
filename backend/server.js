require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const locationRoutes = require('./routes/locations');
const friendRoutes = require('./routes/friends');

const app = express();
const PORT = process.env.PORT || 3001;

// Comma-separated list of allowed origins, e.g. "http://localhost:8080,https://yourapp.vercel.app"
const allowedOrigins = (process.env.CORS_ORIGIN || '*').split(',').map((s) => s.trim());

app.use(cors({
  origin: allowedOrigins.includes('*') ? true : allowedOrigins,
}));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/friends', friendRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`Travel map backend listening on port ${PORT}`);
});
