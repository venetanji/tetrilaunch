-- BOARDS — one leaderboard table, many boards.
--
-- Every score used to be filed under `level = 1` regardless of which Tier the
-- run was flown at (main.ts hardcoded it), so ten different games shared one
-- ranking. That was survivable while only one Tier was reachable at a time; it
-- is indefensible once a cleared Tier can be replayed and a God Tier day has a
-- board of its own that resets at midnight (see docs/LONGEVITY.md).
--
-- A TEXT key rather than more integer columns, because the boards are not all
-- the same kind of thing: `tier:7` is a difficulty, `god:20260824` is a date,
-- and a future `contract:<id>` is a generated puzzle. One key that names its
-- own namespace beats three nullable columns that have to be read together.
--
-- `level` is deliberately LEFT ALONE. Every existing row keeps meaning what it
-- meant, an older client still posts and reads exactly as before (it lands on
-- the DEFAULT board, 'run'), and nothing has to be backfilled for this
-- migration to be safe to apply to a live database.
ALTER TABLE scores ADD COLUMN board TEXT NOT NULL DEFAULT 'run';

-- The read path is always (board, top N by score), which this covers end to
-- end. The old (level, score) index stays: it still serves the legacy board
-- and dropping it would be a second, unrelated change riding along.
CREATE INDEX IF NOT EXISTS idx_scores_board_score ON scores (board, score DESC);
