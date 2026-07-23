// Public Supabase client for read-only data access from the frontend.
//
// The publishable (anon) key below is PUBLIC BY DESIGN - it is safe and
// intentional to ship it in frontend code. Row Level Security on every table
// restricts what it can do: SELECT-only on public data (products,
// price_history, market_stats); the alerts table is service-role only. Do NOT
// "fix" this by hiding or rotating the key out of the frontend - and NEVER put
// the service role key (sb_secret_...) anywhere in frontend/.
//
// Requires the supabase-js v2 UMD bundle to be loaded first (CDN script tag).
window.memradarSupabase = window.supabase.createClient(
  'https://qvkovmgldivrtbonmmhm.supabase.co',
  'sb_publishable_IMOBsgRl71wRWSz-WRBzZw_J6LawkRO'
);
