-- Tier boards: rank a score against the TIER it was flown at.
--
-- Until now every score went to one global list. The client hardcoded the
-- partition key (`submitScore(name, score, 1, lines)` — level was always 1), so
-- the Worker's per-key query has been running against a constant since it was
-- written, and a Tier 1 run and a Tier 9 run shared a table. They are not
-- comparable: the Tier IS the build budget (upgrades.ts's budgetForMark), so a
-- single board ranks players by which Tier they attempted before it ranks them
-- by how well they played it, and the top of it is unreachable for anyone below
-- the top Tier. One column per Tier fixes that.
--
-- ADDITIVE, and deliberately so. `level` stays — it is a real fact about a run
-- (the bay it ended on) that the client is only now starting to send honestly,
-- and dropping a column that shipped clients still POST would break them for
-- nothing. `mark` defaults to 0, which is what a client that predates this
-- migration will effectively store: 0 is "untiered", never a real Tier, and the
-- Worker treats a GET with no mark as the combined board so those clients keep
-- seeing a list with themselves in it.
ALTER TABLE scores ADD COLUMN mark INTEGER NOT NULL DEFAULT 0;

-- The board query is `WHERE mark = ? ORDER BY score DESC`, so this index is the
-- board. idx_scores_level_score stays for the combined/legacy path, which still
-- sorts on score alone.
CREATE INDEX IF NOT EXISTS idx_scores_mark_score ON scores (mark, score DESC);
