// Floating "back to top" button for the long listing pages (/ram/, /ssd/).
// Self-contained: it creates its own button element, so including this script
// is all a page needs, no markup to add.
//
// Visibility is driven by a requestAnimationFrame-throttled scroll read
// (window.scrollY > 1.5 viewports), chosen over an IntersectionObserver
// sentinel: a ~1.5vh marker element would add phantom scroll height on short
// filtered result sets (e.g. a 1-product filter), whereas a rAF-guarded scroll
// comparison runs at most once per frame and never touches layout.
(function () {
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'back-to-top';
  btn.setAttribute('aria-label', 'Back to top');
  btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<line x1="12" y1="19" x2="12" y2="6"/><polyline points="6 12 12 6 18 12"/></svg>';
  document.body.appendChild(btn);

  var ticking = false;
  function update() {
    btn.classList.toggle('visible', window.scrollY > window.innerHeight * 1.5);
    ticking = false;
  }
  function onScrollOrResize() {
    if (!ticking) { window.requestAnimationFrame(update); ticking = true; }
  }
  window.addEventListener('scroll', onScrollOrResize, { passive: true });
  window.addEventListener('resize', onScrollOrResize, { passive: true });
  update();

  btn.addEventListener('click', function () {
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    // Send keyboard focus back to the top of the page (the button itself is
    // about to fade out and become unfocusable).
    var top = document.querySelector('.site-header .logo');
    if (top && top.focus) {
      try { top.focus({ preventScroll: true }); } catch (e) { top.focus(); }
    }
  });
})();
