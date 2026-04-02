const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TheRitzClinic123';
const MAX_SUBMISSIONS_PER_EMAIL = 3;

// Database abstraction: PostgreSQL if DATABASE_URL is set, otherwise SQLite
let db;

if (process.env.DATABASE_URL) {
  // PostgreSQL
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  db = {
    async init() {
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
    },
    async run(sql, params) {
      const result = await pool.query(sql, params);
      return { changes: result.rowCount };
    },
    async all(sql, params) {
      const result = await pool.query(sql, params);
      return result.rows;
    },
    async get(sql, params) {
      const result = await pool.query(sql, params);
      return result.rows[0];
    }
  };
} else {
  // SQLite (local dev)
  const Database = require('better-sqlite3');
  const sqlite = new Database(path.join(__dirname, 'submissions.db'));
  sqlite.pragma('journal_mode = WAL');

  // Adapter: convert $1,$2 style params to ? style
  function convertSQL(sql) {
    let i = 0;
    return sql.replace(/\$\d+/g, () => '?');
  }

  db = {
    async init() {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS submissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nickname TEXT NOT NULL,
          email TEXT NOT NULL,
          gender TEXT NOT NULL,
          school TEXT NOT NULL,
          message TEXT NOT NULL,
          created_at DATETIME DEFAULT (datetime('now'))
        )
      `);
    },
    async run(sql, params) {
      const result = sqlite.prepare(convertSQL(sql)).run(...(params || []));
      return { changes: result.changes };
    },
    async all(sql, params) {
      return sqlite.prepare(convertSQL(sql)).all(...(params || []));
    },
    async get(sql, params) {
      return sqlite.prepare(convertSQL(sql)).get(...(params || []));
    }
  };
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Admin auth middleware
function requireAdmin(req, res, next) {
  const password = req.headers['x-admin-password'];
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: '密码错误' });
  }
  next();
}

// Submit form (max 3 per email)
app.post('/api/submit', async (req, res) => {
  const { nickname, email, gender, school, message } = req.body;
  if (!nickname || !email || !gender || !school || !message) {
    return res.status(400).json({ error: '所有栏目都必须填写' });
  }
  try {
    const row = await db.get(
      'SELECT COUNT(*) as count FROM submissions WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    const count = parseInt(row.count);
    if (count >= MAX_SUBMISSIONS_PER_EMAIL) {
      return res.status(429).json({
        error: `每个邮箱最多提交 ${MAX_SUBMISSIONS_PER_EMAIL} 次，请先删除之前的提交后再试`,
        submissionCount: count
      });
    }

    await db.run(
      'INSERT INTO submissions (nickname, email, gender, school, message) VALUES ($1, $2, $3, $4, $5)',
      [nickname, email, gender, school, message]
    );
    res.json({ success: true, message: '提交成功！' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// Public browse: paginated
app.get('/api/browse', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 12));
  const offset = (page - 1) * limit;

  try {
    const countRow = await db.get('SELECT COUNT(*) as total FROM submissions');
    const total = parseInt(countRow.total);

    const submissions = await db.all(
      'SELECT id, nickname, gender, school, message, created_at FROM submissions ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );

    res.json({
      submissions,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// Lookup own submissions by email (for self-delete)
app.post('/api/my-submissions', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: '请输入邮箱' });
  try {
    const submissions = await db.all(
      'SELECT id, nickname, school, message, created_at FROM submissions WHERE LOWER(email) = LOWER($1) ORDER BY created_at DESC',
      [email]
    );
    res.json({ submissions, count: submissions.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// Delete own submission (requires email verification)
app.post('/api/my-submissions/delete', async (req, res) => {
  const { email, id } = req.body;
  if (!email || !id) return res.status(400).json({ error: '缺少参数' });
  try {
    const result = await db.run(
      'DELETE FROM submissions WHERE id = $1 AND LOWER(email) = LOWER($2)',
      [parseInt(id), email]
    );
    if (result.changes === 0) {
      return res.status(404).json({ error: '未找到该提交或邮箱不匹配' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// Admin: get all submissions (paginated, requires auth)
app.get('/api/submissions', requireAdmin, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  try {
    const countRow = await db.get('SELECT COUNT(*) as total FROM submissions');
    const total = parseInt(countRow.total);

    const submissions = await db.all(
      'SELECT * FROM submissions ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );

    res.json({
      submissions,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// Admin: delete submission (requires auth)
app.delete('/api/submissions/:id', requireAdmin, async (req, res) => {
  try {
    await db.run('DELETE FROM submissions WHERE id = $1', [parseInt(req.params.id)]);
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

db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Admin panel at http://localhost:${PORT}/admin`);
    console.log(`Database: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite (local)'}`);
  });
});
