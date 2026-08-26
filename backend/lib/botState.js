// Durable key/value state for automated jobs, in Supabase.
//
// WHY NOT a repo Actions variable (the first design): the automatic
// GITHUB_TOKEN cannot write them - HTTP 403 "Resource not accessible by
// integration" from both the gh CLI and the REST endpoint, even with
// permissions: actions: write (probed empirically 2026-08-26). The only
// alternatives were a classic-repo-scope PAT or a GitHub App.
//
// WHY NOT scraping our own run logs: Actions log retention expires (90 days
// by default, configurable lower), and "found nothing" is indistinguishable
// from "enumeration failed", so dedup would silently no-op. A guardrail that
// fails OPEN is the wrong shape for a bot whose whole principle is failing
// closed.
//
// This store has no retention limit, needs no extra credential (the service
// key is already an Actions secret), makes no commits, and THROWS on a read
// or write error so the caller fails loudly.
const supabase = require('./supabase');

async function getState(key, fallback = null) {
  const { data, error } = await supabase
    .from('bot_state').select('value').eq('key', key).maybeSingle();
  if (error) throw new Error(`bot_state read failed (${key}): ${error.message}`);
  return data ? data.value : fallback;
}

async function setState(key, value) {
  const { error } = await supabase.from('bot_state').upsert(
    { key, value, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  if (error) throw new Error(`bot_state write failed (${key}): ${error.message}`);
}

module.exports = { getState, setState };
