// Keep enough persisted transcript in-memory for compaction and procedure
// continuity, without reloading an unbounded chat on every turn.
export const LOOP_HISTORY_REPLAY_LIMIT = 200
