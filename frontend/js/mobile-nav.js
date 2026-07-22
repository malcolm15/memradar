// Mobile navigation dropdown (shared across all pages with the site header).
// Owns the hamburger toggle injected into <nav> and the #mobileNavPanel.
// Desktop (>768px) is unaffected — CSS hides both the toggle and the panel.
(function () {
  var toggle = document.getElementById('mobileNavToggle');
  var panel = document.getElementById('mobileNavPanel');
  if (!toggle || !panel) return;

  function isOpen() { return toggle.getAttribute('aria-expanded') === 'true'; }

  function open() {
    toggle.setAttribute('aria-expanded', 'true');
    panel.classList.add('open');
    document.body.classList.add('mobile-nav-open'); // locks body scroll
  }
  function close() {
    toggle.setAttribute('aria-expanded', 'false');
    panel.classList.remove('open');
    document.body.classList.remove('mobile-nav-open');
  }

  toggle.addEventListener('click', function (e) {
    e.stopPropagation();
    isOpen() ? close() : open();
  });

  // Tapping a link navigates away — no state to manage. Close on any tap
  // outside the panel and toggle.
  document.addEventListener('click', function (e) {
    if (!isOpen()) return;
    if (panel.contains(e.target) || toggle.contains(e.target)) return;
    close();
  });

  // Escape closes and returns focus to the toggle.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen()) { close(); toggle.focus(); }
  });

  // If the viewport grows to desktop while open, close and unlock scroll.
  window.addEventListener('resize', function () {
    if (isOpen() && window.innerWidth > 768) close();
  });
})();
