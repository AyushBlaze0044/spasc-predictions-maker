// ================= SPASC PREDICTIONS MAKER =================
// FINAL BACKEND WITH REGISTRATION + LOGIN MEMORY SUPPORT

const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const db = new sqlite3.Database("./spasc.db");

/* ================= DATABASE ================= */
db.serialize(() => {

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    wallet INTEGER DEFAULT 10000
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS match (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teamA TEXT,
    teamB TEXT,
    overs INTEGER,
    tossWinner TEXT,
    tossDecision TEXT,
    bettingOpen INTEGER DEFAULT 0,
    status TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS squad (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    matchId INTEGER,
    team TEXT,
    player TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS bets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    matchId INTEGER,
    phase TEXT,
    betType TEXT,
    selection TEXT,
    minVal INTEGER,
    maxVal INTEGER,
    stake INTEGER,
    odds REAL,
    result TEXT
  )`);
});

/* ================= REGISTER ================= */
app.post("/auth/register", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.json({ error: "Missing fields" });

  const hash = bcrypt.hashSync(password, 8);

  db.run(
    "INSERT INTO users (email,password) VALUES (?,?)",
    [email, hash],
    err => {
      if (err) return res.json({ error: "User already exists" });
      res.json({ success: true });
    }
  );
});

/* ================= LOGIN ================= */
app.post("/auth/login", (req, res) => {
  const { email, password } = req.body;

  // ADMIN LOGIN (HARD CODED)
  if (email === "ceospasc@gmail.com" && password === "955786@0044") {
    return res.json({ role: "admin" });
  }

  db.get("SELECT * FROM users WHERE email=?", [email], (e, user) => {
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.json({ error: "Invalid credentials" });
    }

    res.json({
      role: "user",
      userId: user.id,
      wallet: user.wallet
    });
  });
});

/* ================= MATCH ================= */
app.post("/admin/create-match", (req, res) => {
  const { teamA, teamB, overs } = req.body;
  db.run(
    "INSERT INTO match (teamA,teamB,overs,status) VALUES (?,?,?,?)",
    [teamA, teamB, overs, "CREATED"]
  );
  res.json({ success: true });
});

app.post("/admin/toggle-betting", (req, res) => {
  db.run(
    "UPDATE match SET bettingOpen=? WHERE id=?",
    [req.body.value, req.body.matchId]
  );
  res.json({ success: true });
});

app.get("/match/current", (req, res) => {
  db.get("SELECT * FROM match ORDER BY id DESC LIMIT 1", [], (e, m) => {
    res.json(m || {});
  });
});

/* ================= BETTING ================= */
function calculateOdds(type, min, max) {
  let base = 2.0;
  if (type === "PLAYER_OF_MATCH") base = 4.0;
  if (max !== null) base += (max - min) / 10;
  return parseFloat(base.toFixed(2));
}

app.post("/bet/place", (req, res) => {
  const b = req.body;

  db.get("SELECT wallet FROM users WHERE id=?", [b.userId], (e, u) => {
    if (!u || u.wallet < b.stake)
      return res.json({ error: "Insufficient balance" });

    const odds = calculateOdds(b.betType, b.minVal, b.maxVal);

    db.run(
      `INSERT INTO bets
       (userId,matchId,phase,betType,selection,minVal,maxVal,stake,odds)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        b.userId, b.matchId, b.phase,
        b.betType, b.selection,
        b.minVal, b.maxVal,
        b.stake, odds
      ]
    );

    db.run(
      "UPDATE users SET wallet = wallet - ? WHERE id=?",
      [b.stake, b.userId]
    );

    res.json({ success: true, odds });
  });
});

/* ================= START ================= */
app.listen(3000, () => {
  console.log("🏏 SPASC Predictions Maker backend running on port 3000");
});
