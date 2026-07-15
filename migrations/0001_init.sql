-- Tetrilaunch leaderboard schema (applied to D1 `tetrilaunch-leaderboard`).
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  lines INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scores_level_score ON scores (level, score DESC);
