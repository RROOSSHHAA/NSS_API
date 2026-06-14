const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on('connect', () => {
  console.log('✅ Connected to Supabase (PostgreSQL) Successfully!');
});

pool.on('error', (err) => {
  console.error('❌ Supabase Connection Failed:', err.message);
});

module.exports = pool;