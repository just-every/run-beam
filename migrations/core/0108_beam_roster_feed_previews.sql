-- Feed preparation is write-free until the owner applies the ordinary roster preview.
CREATE TABLE beam_roster_feeds (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, headers_json TEXT NOT NULL, mapping_json TEXT NOT NULL,
 interval_minutes INTEGER NOT NULL CHECK(interval_minutes BETWEEN 15 AND 1440),
 termination_limit INTEGER NOT NULL CHECK(termination_limit BETWEEN 1 AND 100),
 created_at INTEGER NOT NULL, last_received_at INTEGER
);
CREATE TABLE beam_roster_feed_receipts (
 id TEXT PRIMARY KEY, feed_id TEXT NOT NULL REFERENCES beam_roster_feeds(id), digest TEXT NOT NULL,
 state TEXT NOT NULL, reason TEXT, batch_id TEXT REFERENCES beam_roster_batches(id), received_at INTEGER NOT NULL,
 UNIQUE(feed_id,digest)
);
