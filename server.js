const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const bodyParser = require("body-parser");

const app = express();
app.use(cors());
app.use(bodyParser.json());

/* ======================
   DATABASE
====================== */
const db = new sqlite3.Database("./spasc.db");

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    wallet INTEGER DEFAULT 0,
    total_winnings INTEGER DEFAULT 0,
    role TEXT DEFAULT 'user'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teamA TEXT,
    teamB TEXT,
    status TEXT DEFAULT 'OPEN'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS bets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    matchId INTEGER,
    betType TEXT,
    selection TEXT,
    amount INTEGER,
    odds REAL,
    result TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS odds (
    matchId INTEGER,
    betType TEXT,
    selection TEXT,
    odds REAL,
    PRIMARY KEY (matchId, betType, selection)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS club (
    id INTEGER PRIMARY KEY,
    access_code TEXT
  )`);

  db.run(`INSERT OR IGNORE INTO club (id, access_code) VALUES (1,'SPASC123')`);
});

/* ======================
   AUTH
====================== */
const SECRET = "SPASC_SECRET";

app.post("/auth/register", (req, res) => {
  const hash = bcrypt.hashSync(req.body.password, 8);
  db.run(
    "INSERT INTO users (email,password) VALUES (?,?)",
    [req.body.email, hash],
    err => {
      if (err) return res.status(400).json({ error: "User already exists" });
      res.json({ message: "Registered successfully" });
    }
  );
});

app.post("/auth/login", (req, res) => {
  db.get(
    "SELECT * FROM users WHERE email=?",
    [req.body.email],
    (err, user) => {
      if (!user) return res.status(404).json({ error: "User not found" });
      if (!bcrypt.compareSync(req.body.password, user.password))
        return res.status(401).json({ error: "Wrong password" });

      const token = jwt.sign({ id: user.id }, SECRET);
      res.json({
        token,
        userId: user.id,
        wallet: user.wallet
      });
    }
  );
});

app.post("/auth/club-access", (req, res) => {
  db.get("SELECT access_code FROM club WHERE id=1", (err, row) => {
    if (row.access_code !== req.body.code)
      return res.status(403).json({ error: "Wrong club code" });
    res.json({ success: true });
  });
});

/* ======================
   LIVE ODDS LOGIC
====================== */
function updateOdds(matchId, betType) {
  db.all(
    "SELECT selection, SUM(amount) as total FROM bets WHERE matchId=? AND betType=? GROUP BY selection",
    [matchId, betType],
    (err, rows) => {
      if (!rows || rows.length === 0) return;

      const totalPool = rows.reduce((a, b) => a + b.total, 0);

      rows.forEach(r => {
        let odds = (2 * totalPool) / r.total;
        odds = Math.min(Math.max(odds, 1.2), 5);
        db.run(
          "INSERT OR REPLACE INTO odds VALUES (?,?,?,?)",
          [matchId, betType, r.selection, odds.toFixed(2)]
        );
      });
    }
  );
}

/* ======================
   BETTING
====================== */
app.post("/bet/place", (req, res) => {
  const { userId, matchId, betType, selection, amount } = req.body;

  db.get("SELECT wallet FROM users WHERE id=?", [userId], (e, u) => {
    if (!u || u.wallet < amount)
      return res.status(400).json({ error: "Insufficient wallet balance" });

    db.get(
      "SELECT odds FROM odds WHERE matchId=? AND betType=? AND selection=?",
      [matchId, betType, selection],
      (e, o) => {
        const odds = o ? o.odds : 2.0;

        db.run(
          "INSERT INTO bets (userId,matchId,betType,selection,amount,odds) VALUES (?,?,?,?,?,?)",
          [userId, matchId, betType, selection, amount, odds]
        );

        db.run(
          "UPDATE users SET wallet = wallet - ? WHERE id=?",
          [amount, userId]
        );

        updateOdds(matchId, betType);
        res.json({ message: "Bet placed", odds });
      }
    );
  });
});

app.get("/bet/odds/:matchId/:betType", (req, res) => {
  db.all(
    "SELECT selection, odds FROM odds WHERE matchId=? AND betType=?",
    [req.params.matchId, req.params.betType],
    (e, rows) => res.json(rows)
  );
});

/* ======================
   ADMIN
====================== */
app.post("/admin/allocate", (req, res) => {
  db.run(
    "UPDATE users SET wallet = wallet + ? WHERE id=?",
    [req.body.amount, req.body.userId]
  );
  res.json({ message: "Wallet allocated" });
});

app.post("/admin/set-odds", (req, res) => {
  db.run(
    "INSERT OR REPLACE INTO odds VALUES (?,?,?,?)",
    [req.body.matchId, req.body.betType, req.body.selection, req.body.odds]
  );
  res.json({ message: "Odds overridden manually" });
});

app.post("/admin/result", (req, res) => {
  const { matchId, winningSelection } = req.body;

  db.all("SELECT * FROM bets WHERE matchId=?", [matchId], (e, bets) => {
    bets.forEach(b => {
      if (b.selection === winningSelection) {
        const win = b.amount * b.odds;
        const net = win - b.amount;

        db.run(
          "UPDATE users SET wallet = wallet + ?, total_winnings = total_winnings + ? WHERE id=?",
          [win, net, b.userId]
        );
        db.run("UPDATE bets SET result='WIN' WHERE id=?", [b.id]);
      } else {
        db.run("UPDATE bets SET result='LOSE' WHERE id=?", [b.id]);
      }
    });
  });

  res.json({ message: "Match settled successfully" });
});

/* ======================
   LEADERBOARD
====================== */
app.get("/admin/leaderboard", (req, res) => {
  db.all(
    "SELECT email,wallet,total_winnings FROM users ORDER BY wallet DESC, total_winnings DESC",
    [],
    (e, rows) => res.json(rows)
  );
});

/* ======================
   PROFIT / LOSS
====================== */
app.get("/admin/profit-loss", (req, res) => {
  db.all("SELECT * FROM bets", (e, bets) => {
    let total = 0;
    let payout = 0;

    bets.forEach(b => {
      total += b.amount;
      if (b.result === "WIN") payout += b.amount * b.odds;
    });

    res.json({
      totalBets: total,
      totalPayout: payout,
      profit: total - payout
    });
  });
});

/* ======================
   START SERVER
====================== */
app.listen(3000, () => {
  console.log("🏏 SPASC Predictions Maker running at http://localhost:3000");
});
