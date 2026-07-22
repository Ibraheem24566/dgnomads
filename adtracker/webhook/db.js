const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000 
});

module.exports = pool;
