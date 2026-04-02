const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS submissions (
      id SERIAL PRIMARY KEY,
      nickname TEXT NOT NULL,
      email TEXT NOT NULL,
      gender TEXT NOT NULL,
      school TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Submit form
app.post('/api/submit', async (req, res) => {
  const { nickname, email, gender, school, message } = req.body;
  if (!nickname || !email || !gender || !school || !message) {
    return res.status(400).json({ error: '所有栏目都必须填写' });
  }
  try {
    await pool.query(
      'INSERT INTO submissions (nickname, email, gender, school, message) VALUES ($1, $2, $3, $4, $5)',
      [nickname, email, gender, school, message]
    );
    res.json({ success: true, message: '提交成功！' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// Get all submissions (admin)
app.get('/api/submissions', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM submissions ORDER BY created_at DESC');
    res.json({ submissions: result.rows, total: result.rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// Delete a submission (admin)
app.delete('/api/submissions/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM submissions WHERE id = $1', [parseInt(req.params.id)]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// Admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`🔒 Admin panel at http://localhost:${PORT}/admin`);
  });
});
