const searchForm = document.getElementById('searchForm');
const searchInput = document.getElementById('searchInput');

// Client-side search rate limiting
// TODO: When search is wired to Supabase, add server-side rate limiting at the API level too
const searchAttempts = [];
const SEARCH_LIMIT = 30;
const SEARCH_WINDOW = 60 * 1000; // 1 minute

function isSearchRateLimited() {
  const now = Date.now();
  const windowStart = now - SEARCH_WINDOW;
  const recent = searchAttempts.filter(t => t > windowStart);
  if (recent.length >= SEARCH_LIMIT) return true;
  searchAttempts.push(now);
  return false;
}

if (searchForm) searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;
  if (isSearchRateLimited()) {
    const hint = searchForm.querySelector('.search-rate-limit-msg') || (() => {
      const el = document.createElement('p');
      el.className = 'search-hint search-rate-limit-msg';
      searchForm.appendChild(el);
      return el;
    })();
    hint.textContent = 'Too many searches — please wait a moment.';
    setTimeout(() => { hint.textContent = ''; }, 3000);
    return;
  }
  // Search logic connects to backend here once API is live
  console.log('Search submitted:', query);
});
