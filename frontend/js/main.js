const searchForm = document.getElementById('searchForm');
const searchInput = document.getElementById('searchInput');

// Client-side rate limiting on form submits. Search itself runs locally
// against a static index (no server cost) - this only guards against
// pathological automation, so the ceiling is generous.
const searchAttempts = [];
const SEARCH_LIMIT = 120;
const SEARCH_WINDOW = 60 * 1000; // 1 minute

function isSearchRateLimited() {
  const now = Date.now();
  const windowStart = now - SEARCH_WINDOW;
  const recent = searchAttempts.filter(t => t > windowStart);
  if (recent.length >= SEARCH_LIMIT) return true;
  searchAttempts.push(now);
  return false;
}

if (searchForm && searchInput) {
  // Typeahead: search.js attaches the dropdown; this form handles Enter/submit.
  // search.js loads after main.js, so attach lazily.
  let heroSearch = null;
  function ensureAttached() {
    if (!heroSearch && window.memradarSearch) {
      heroSearch = window.memradarSearch.attach(searchInput, {
        container: searchForm,
        formHandlesEnter: true
      });
    }
    return heroSearch;
  }

  searchInput.addEventListener('focus', ensureAttached);

  searchForm.addEventListener('submit', (e) => {
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
      hint.textContent = 'Too many searches. Please wait a moment.';
      setTimeout(() => { hint.textContent = ''; }, 3000);
      return;
    }
    const api = ensureAttached();
    if (api) api.submitQuery();
  });

  // "Try:" suggestion chips - populate the input and search immediately.
  document.querySelectorAll('.search-try').forEach(chip => {
    chip.addEventListener('click', () => {
      searchInput.value = chip.dataset.q || chip.textContent.trim();
      searchInput.focus();
      const api = ensureAttached();
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
}
