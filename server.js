const express = require('express');
const path = require('path');
const initSqlJs = require('sql.js');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.RENDER ? path.join('/tmp', 'submissions.db') : path.join(__dirname, 'submissions.db');

let db;

async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT NOT NULL,
      email TEXT NOT NULL,
      gender TEXT NOT NULL,
      school TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  saveDB();
}

function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Submit form
app.post('/api/submit', (req, res) => {
  const { nickname, email, gender, school, message } = req.body;
  if (!nickname || !email || !gender || !school || !message) {
    return res.status(400).json({ error: '所有栏目都必须填写' });
  }
  db.run(
    'INSERT INTO submissions (nickname, email, gender, school, message) VALUES (?, ?, ?, ?, ?)',
    [nickname, email, gender, school, message]
  );
  saveDB();
  res.json({ success: true, message: '提交成功！' });
});

// Get all submissions (admin)
app.get('/api/submissions', (req, res) => {
  const rows = db.exec('SELECT * FROM submissions ORDER BY created_at DESC');
  if (rows.length === 0) return res.json({ submissions: [], total: 0 });
  const columns = rows[0].columns;
  const submissions = rows[0].values.map(row => {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
  res.json({ submissions, total: submissions.length });
});

// Delete a submission (admin)
app.delete('/api/submissions/:id', (req, res) => {
  db.run('DELETE FROM submissions WHERE id = ?', [parseInt(req.params.id)]);
  saveDB();
  res.json({ success: true });
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
