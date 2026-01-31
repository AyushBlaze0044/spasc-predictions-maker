// ================= SPASC PREDICTIONS MAKER =================
// FINAL BACKEND — FULLY FROZEN LOGIC

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

  db.run(`CREATE TABLE IF NOT EXISTS innings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    matchId INTEGER,
    inningsNo INTEGER,
    team TEXT,
    runs INTEGER,
    wickets INTEGER,
    overs REAL,
    extras INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS player_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    matchId INTEGER,
    inningsNo INTEGER,
    player TEXT,
    runs INTEGER,
    balls INTEGER,
    overs REAL,
    maidens INTEGER,
    runsConceded INTEGER,
    wickets INTEGER
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

// ================= AUTH =================
app.post("/auth/login", (req, res) => {
  const { email, password } = req.body;

  // ADMIN LOGIN (HARD LOCKED)
  if (email === "ceospasc@gmail.com" && password === "955786@0044") {
    return res.json({ role: "admin" });
  }

  db.get("SELECT * FROM users WHERE email=?", [email], (e, user) => {
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.json({ error: "Invalid credentials" });
    }
    res.json({ role: "user", userId: user.id, wallet: user.wallet });
  });
});

// ================= MATCH =================
app.post("/admin/create-match", (req, res) => {
  const { teamA, teamB, overs } = req.body;
  db.run(
    "INSERT INTO match (teamA,teamB,overs,status) VALUES (?,?,?,?)",
    [teamA, teamB, overs, "CREATED"]
  );
  res.json({ success: true });
});

app.post("/admin/toss", (req, res) => {
  const { matchId, winner, decision } = req.body;
  db.run(
    "UPDATE match SET tossWinner=?, tossDecision=? WHERE id=?",
    [winner, decision, matchId]
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

// ================= SQUAD =================
app.post("/admin/add-squad", (req, res) => {
  const { matchId, team, player } = req.body;
  db.run(
    "INSERT INTO squad (matchId,team,player) VALUES (?,?,?)",
    [matchId, team, player]
  );
  res.json({ success: true });
});

app.get("/squad/:matchId", (req, res) => {
  db.all(
    "SELECT * FROM squad WHERE matchId=?",
    [req.params.matchId],
    (e, rows) => res.json(rows)
  );
});

// ================= BETTING =================
function calculateOdds(type, min, max) {
  let base = 2.0;
  if (type === "PLAYER_OF_MATCH") base = 4.0;
  if (max !== null) base += (max - min) / 10;
  return parseFloat(base.toFixed(2));
}

app.post("/bet/place", (req, res) => {
  const b = req.body;

  // stake validation
  if (b.stake < 100) return res.json({ error: "Invalid stake" });

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

// ================= INNINGS DATA =================
app.post("/admin/innings", (req, res) => {
  const i = req.body;
  db.run(
    `INSERT INTO innings (matchId,inningsNo,team,runs,wickets,overs,extras)
     VALUES (?,?,?,?,?,?,?)`,
    [i.matchId,i.inningsNo,i.team,i.runs,i.wickets,i.overs,i.extras]
  );
  res.json({ success: true });
});

app.post("/admin/player-stats", (req, res) => {
  const p = req.body;
  db.run(
    `INSERT INTO player_stats 
    (matchId,inningsNo,player,runs,balls,overs,maidens,runsConceded,wickets)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [p.matchId,p.inningsNo,p.player,p.runs,p.balls,p.overs,p.maidens,p.runsConceded,p.wickets]
  );
  res.json({ success: true });
});

// ================= SETTLEMENT =================
app.post("/admin/settle", (req, res) => {
  const { matchId } = req.body;

  db.all("SELECT * FROM bets WHERE matchId=?", [matchId], (e, bets) => {
    bets.forEach(b => {
      let win = false;

      // simple settlement logic
      if (b.betType === "MATCH_WINNER") {
        if (b.selection === req.body.winner) win = true;
      }

      if (b.betType === "PLAYER_RUNS") {
        if (b.actual >= b.minVal && b.actual <= b.maxVal) win = true;
      }

      if (win) {
        const payout = b.stake * b.odds;
        db.run(
          "UPDATE users SET wallet = wallet + ? WHERE id=?",
          [payout, b.userId]
        );
        db.run("UPDATE bets SET result='WIN' WHERE id=?", [b.id]);
      } else {
        db.run("UPDATE bets SET result='LOSE' WHERE id=?", [b.id]);
      }
    });
  });

  db.run("UPDATE match SET status='COMPLETED' WHERE id=?", [matchId]);
  res.json({ success: true });
});

// ================= START =================
app.listen(3000, () => {
  console.log("🏏 SPASC Predictions Maker backend running on port 3000");
});
