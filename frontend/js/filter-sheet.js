// Mobile bottom-sheet filters for the listing pages (/ram/, /ssd/).
// Desktop (>768px) is untouched: at the mobile breakpoint this module MOVES
// the existing .filter-row elements into a bottom sheet and the sort group
// into a slim control bar, then moves them back at desktop width. One set of
// elements, one set of listeners - product-listing.js remains the single
// source of truth for filter/sort state, so search (?q=), the count line,
// and all filter logic work identically. No filter logic lives here.
(function () {
  var wrap = document.querySelector('.filter-bar-wrap');
  if (!wrap) return;
  var container = wrap.querySelector('.filter-bar .container');
  if (!container) return;
  var rows = Array.prototype.slice.call(container.querySelectorAll('.filter-row'));
  if (!rows.length) return;

  var sortSelect = container.querySelector('.filter-select');
  var sortGroup = sortSelect ? sortSelect.closest('.filter-group') : null;
  var sortHome = sortGroup ? { parent: sortGroup.parentNode, next: sortGroup.nextSibling } : null;

  // ---- slim control bar (shown only <=768px via CSS) ----
  var bar = document.createElement('div');
  bar.className = 'mobile-filter-bar';
  bar.innerHTML =
    '<button type="button" class="mobile-filter-btn" aria-haspopup="dialog">' +
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>' +
      '<span class="mobile-filter-btn-label">Filters</span>' +
    '</button>' +
    '<div class="mobile-filter-sort-slot"></div>';
  container.appendChild(bar);
  var filterBtn = bar.querySelector('.mobile-filter-btn');
  var btnLabel = bar.querySelector('.mobile-filter-btn-label');
  var sortSlot = bar.querySelector('.mobile-filter-sort-slot');

  // ---- bottom sheet ----
  var overlay = document.createElement('div');
  overlay.className = 'filter-sheet-overlay';
  overlay.innerHTML =
    '<div class="filter-sheet" role="dialog" aria-modal="true" aria-label="Filters">' +
      '<div class="filter-sheet-header">' +
        '<span class="filter-sheet-handle" aria-hidden="true"></span>' +
        '<h2 class="filter-sheet-title">Filters</h2>' +
        '<button type="button" class="filter-sheet-close" aria-label="Close filters">' +
          '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M14 4L4 14M4 4l10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="filter-sheet-body"></div>' +
      '<div class="filter-sheet-footer">' +
        '<button type="button" class="filter-sheet-clear">Clear All</button>' +
        '<button type="button" class="filter-sheet-apply">Show products</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  var sheet = overlay.querySelector('.filter-sheet');
  var sheetHeader = overlay.querySelector('.filter-sheet-header');
  var sheetBody = overlay.querySelector('.filter-sheet-body');
  var closeBtn = overlay.querySelector('.filter-sheet-close');
  var clearBtn = overlay.querySelector('.filter-sheet-clear');
  var applyBtn = overlay.querySelector('.filter-sheet-apply');

  // ---- badge + live count (fed by product-listing.js via a custom event) ----
  function activeFilterCount() {
    var n = 0;
    rows.forEach(function (row) {
      row.querySelectorAll('.filter-pills').forEach(function (pills) {
        var active = pills.querySelector('.filter-pill.active');
        if (active && active !== pills.querySelector('.filter-pill')) n++;
      });
    });
    return n;
  }
  function updateBadge() {
    var n = activeFilterCount();
    btnLabel.textContent = n ? 'Filters · ' + n : 'Filters';
  }
  document.addEventListener('memradar:listing-count', function (e) {
    var n = e.detail.count;
    applyBtn.textContent = 'Show ' + n + ' product' + (n === 1 ? '' : 's');
    updateBadge();
  });

  // ---- open / close ----
  function openSheet() {
    // Only one overlay at a time: close the mobile nav via its own toggle so
    // its aria-expanded/icon state stays correct.
    if (document.body.classList.contains('mobile-nav-open')) {
      var navToggle = document.getElementById('mobileNavToggle');
      if (navToggle) navToggle.click();
    }
    overlay.classList.add('open');
    document.body.classList.add('filter-sheet-open');
    updateBadge();
    setTimeout(function () { closeBtn.focus(); }, 60);
  }
  function closeSheet(skipFocus) {
    if (!overlay.classList.contains('open')) return;
    overlay.classList.remove('open');
    document.body.classList.remove('filter-sheet-open');
    sheet.style.transform = '';
    if (!skipFocus) filterBtn.focus();
  }
  filterBtn.addEventListener('click', openSheet);
  closeBtn.addEventListener('click', function () { closeSheet(); });
  applyBtn.addEventListener('click', function () { closeSheet(); });
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeSheet(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeSheet();
  });

  // Clear All drives the real pills (first pill in each group is "All"), so
  // desktop state, the count line, and the grid all update through the one
  // existing code path.
  clearBtn.addEventListener('click', function () {
    rows.forEach(function (row) {
      row.querySelectorAll('.filter-pills').forEach(function (pills) {
        var first = pills.querySelector('.filter-pill');
        var active = pills.querySelector('.filter-pill.active');
        if (first && active && active !== first) first.click();
      });
    });
    updateBadge();
  });

  // Swipe-down on the sheet header closes it.
  var touchY = null;
  sheetHeader.addEventListener('touchstart', function (e) {
    touchY = e.touches[0].clientY;
  }, { passive: true });
  sheetHeader.addEventListener('touchmove', function (e) {
    if (touchY == null) return;
    var dy = e.touches[0].clientY - touchY;
    if (dy > 0) sheet.style.transform = 'translateY(' + dy + 'px)';
  }, { passive: true });
  sheetHeader.addEventListener('touchend', function (e) {
    if (touchY == null) return;
    var dy = e.changedTouches[0].clientY - touchY;
    touchY = null;
    if (dy > 80) closeSheet(); else sheet.style.transform = '';
  });

  // ---- breakpoint sync: move the real elements, never clone them ----
  var mq = window.matchMedia('(max-width: 768px)');
  function toMobile() {
    rows.forEach(function (row) { sheetBody.appendChild(row); });
    if (sortGroup) sortSlot.appendChild(sortGroup);
  }
  function toDesktop() {
    closeSheet(true);
    rows.forEach(function (row) { container.insertBefore(row, bar); });
    if (sortGroup && sortHome) sortHome.parent.insertBefore(sortGroup, sortHome.next);
  }
  function sync() { if (mq.matches) toMobile(); else toDesktop(); }
  if (mq.addEventListener) mq.addEventListener('change', sync);
  else mq.addListener(sync);
  sync();
})();
