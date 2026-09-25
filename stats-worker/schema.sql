CREATE TABLE IF NOT EXISTS events (
  id  INTEGER PRIMARY KEY AUTOINCREMENT,
  ts  TEXT NOT NULL,          -- UTC ISO time
  sid TEXT NOT NULL,          -- random per page load, not stored in the browser (no cross-visit tracking)
  ev  TEXT NOT NULL,          -- start | finish | leave
  qid TEXT,                   -- id of the furthest question reached (e.g. "incomeSS") — never an answer
  qn  INTEGER,                -- furthest question number reached (1-based)
  qt  INTEGER,                -- total questions shown to that person
  dev TEXT                    -- "m" (phone-width) or "d" (desktop)
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_sid ON events(sid);
