// ================= SPASC PREDICTIONS MAKER =================
// FINAL BACKEND — FEATURE COMPLETE (ADMIN + USER + ANALYTICS)

const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const db = new sqlite3.Database("./spasc.db");

// ================= DATABASE =================
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    wallet INTEGER DEFAULT 10000,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS match (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teamA TEXT,
    teamB TEXT,
    overs INTEGER,
    tossWinner TEXT,
    tossDecision TEXT,
    bettingOpen INTEGER DEFAULT 0,
    status TEXT DEFAULT 'CREATED',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS squads (
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

  db.run(`CREATE TABLE IF NOT EXISTS admin_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT,
    payload TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// ================= HELPERS =================
function logAdmin(action, payload) {
  db.run(
    "INSERT INTO admin_logs (action,payload) VALUES (?,?)",
    [action, JSON.stringify(payload)]
  );
}

function calculateOdds(type, min, max) {
  let base = 2.0;
  switch (type) {
    case "MATCH_WINNER": base = 1.9; break;
    case "PLAYER_RUNS": base = 2.2; break;
    case "PLAYER_WICKETS": base = 2.5; break;
    case "RUNS_CONCEDED": base = 2.3; break;
    case "EXTRAS": base = 2.1; break;
    case "PLAYER_OF_MATCH": base = 4.5; break;
  }
  if (min !== null && max !== null) base += (max - min) / 10;
  return Number(base.toFixed(2));
}

// ================= AUTH =================
app.post("/auth/register", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.json({ error: "Missing fields" });
  const hash = bcrypt.hashSync(password, 8);
  db.run(
    "INSERT INTO users (email,password) VALUES (?,?)",
    [email, hash],
    err => err ? res.json({ error: "User exists" }) : res.json({ success: true })
  );
});

app.post("/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (email === "ceospasc@gmail.com" && password === "955786@0044") {
    return res.json({ role: "admin" });
  }
  db.get("SELECT * FROM users WHERE email=?", [email], (e, u) => {
    if (!u || !bcrypt.compareSync(password, u.password))
      return res.json({ error: "Invalid credentials" });
    res.json({ role: "user", userId: u.id, wallet: u.wallet });
  });
});

// ================= MATCH =================
app.post("/admin/create-match", (req, res) => {
  const { teamA, teamB, overs } = req.body;
  db.run("INSERT INTO match (teamA,teamB,overs) VALUES (?,?,?)",
    [teamA, teamB, overs]);
  logAdmin("CREATE_MATCH", req.body);
  res.json({ success: true });
});

app.post("/admin/edit-match", (req, res) => {
  const { matchId, teamA, teamB, overs } = req.body;
  db.run("UPDATE match SET teamA=?,teamB=?,overs=? WHERE id=?",
    [teamA, teamB, overs, matchId]);
  logAdmin("EDIT_MATCH", req.body);
  res.json({ success: true });
});

app.post("/admin/toss", (req, res) => {
  const { matchId, winner, decision } = req.body;
  db.run("UPDATE match SET tossWinner=?,tossDecision=? WHERE id=?",
    [winner, decision, matchId]);
  logAdmin("TOSS", req.body);
  res.json({ success: true });
});

app.post("/admin/toggle-betting", (req, res) => {
  const { matchId, value } = req.body;
  db.run("UPDATE match SET bettingOpen=? WHERE id=?", [value, matchId]);
  logAdmin("BETTING_TOGGLE", req.body);
  res.json({ success: true });
});

app.get("/match/current", (req, res) => {
  db.get("SELECT * FROM match ORDER BY id DESC LIMIT 1", [], (e, m) => res.json(m||{}));
});

// ================= SQUADS =================
app.post("/admin/add-player", (req, res) => {
  const { matchId, team, player } = req.body;
  db.run("INSERT INTO squads (matchId,team,player) VALUES (?,?,?)",
    [matchId, team, player]);
  logAdmin("ADD_PLAYER", req.body);
  res.json({ success: true });
});

app.get("/squads/:matchId", (req, res) => {
  db.all("SELECT * FROM squads WHERE matchId=?", [req.params.matchId],
    (e, rows) => res.json(rows));
});

// ================= BETTING =================
app.post("/bet/place", (req, res) => {
  const b = req.body;
  if (b.stake < 100) return res.json({ error: "Invalid stake" });
  db.get("SELECT wallet FROM users WHERE id=?", [b.userId], (e, u) => {
    if (!u || u.wallet < b.stake) return res.json({ error: "Insufficient balance" });
    const odds = calculateOdds(b.betType, b.minVal, b.maxVal);
    db.run(`INSERT INTO bets
      (userId,matchId,phase,betType,selection,minVal,maxVal,stake,odds)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      [b.userId,b.matchId,b.phase,b.betType,b.selection,b.minVal,b.maxVal,b.stake,odds]);
    db.run("UPDATE users SET wallet=wallet-? WHERE id=?", [b.stake,b.userId]);
    res.json({ success: true, odds });
  });
});

// ================= ANALYTICS =================
app.get("/user/bets/:userId", (req, res) => {
  db.all("SELECT * FROM bets WHERE userId=? ORDER BY id DESC",
    [req.params.userId], (e, rows) => res.json(rows));
});

app.get("/leaderboard", (req, res) => {
  db.all("SELECT email,wallet FROM users ORDER BY wallet DESC",
    [], (e, rows) => res.json(rows));
});

app.get("/admin/pl", (req, res) => {
  db.get(`SELECT 
    SUM(stake) as totalStake,
    SUM(CASE WHEN result='WIN' THEN stake*odds ELSE 0 END) as totalPayout
    FROM bets`, [], (e, r) => {
      res.json({
        totalStake: r?.totalStake||0,
        totalPayout: r?.totalPayout||0,
        profit: (r?.totalStake||0)-(r?.totalPayout||0)
      });
  });
});

// ================= START =================
app.listen(3000, () => console.log("🏏 SPASC backend running on :3000"));
