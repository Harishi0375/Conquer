const { Pool } = require('pg');

// Hosted Postgres providers (Supabase, Neon, Render) require SSL.
// Local docker-compose Postgres does not, so we only force SSL when
// the connection string points somewhere that isn't "localhost".
const isLocal = (process.env.DATABASE_URL || '').includes('localhost')
  || (process.env.DATABASE_URL || '').includes('postgres:5432')
  || (process.env.DATABASE_URL || '').includes('@postgres');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false }
});

pool.on('error', (err) => {
  console.error('Unexpected Postgres error on idle client', err);
});

module.exports = pool;
