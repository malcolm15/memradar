(function () {
  // ---- Shared alert-submit helper (used by this modal AND pdp-alert.js) ----
  // alert-modal.js is included on every page, so this is always available.
  window.memradarAlert = {
    ENDPOINT: 'https://memradar-three.vercel.app/api/alerts',
    // Read the Turnstile token from the widget inside a scope element.
    turnstileToken: function (scopeEl) {
      var el = scopeEl && scopeEl.querySelector('[name="cf-turnstile-response"]');
      return el ? el.value : '';
    },
    // Ensure the Turnstile API script is present (the modal lives on pages that
    // may not include it in <head>).
    ensureTurnstile: function () {
      if (document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')) return;
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.async = true; s.defer = true;
      document.head.appendChild(s);
    },
    submit: function (payload) {
      return fetch(this.ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          return { ok: res.ok, status: res.status, data: data };
        });
      });
    }
  };

  var currentStep = 1;
  var selectedProduct = null; // { sku, name, category, current_price }
  var lastResults = [];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v) {
    return v == null ? 'N/A' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }

  function buildModal() {
    var el = document.createElement('div');
    el.className = 'modal-overlay';
    el.id = 'alertModal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Set a price alert');
    el.innerHTML = `
      <div class="modal-card" id="modalCard">
        <div class="modal-header">
          <div class="modal-progress" aria-hidden="true">
            <span class="modal-dot" data-step="1"></span>
            <span class="modal-dot" data-step="2"></span>
            <span class="modal-dot" data-step="3"></span>
            <span class="modal-dot" data-step="4"></span>
          </div>
          <span class="modal-step-label" id="modalStepLabel">Step 1 of 4</span>
          <button class="modal-close-btn" id="modalCloseBtn" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M14 4L4 14M4 4l10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <div class="modal-body">

          <div class="modal-step active" id="modalStep1">
            <h2 class="modal-heading">What would you like to track?</h2>
            <p class="modal-subheading">Search for a RAM or SSD product</p>
            <div class="modal-search-wrap">
              <input type="text" class="modal-input" id="modalSearchInput"
                placeholder="e.g. G.Skill Trident Z5 DDR5 32GB" autocomplete="off">
              <button class="modal-btn-primary" id="modalSearchBtn">Search</button>
            </div>
          </div>

          <div class="modal-step" id="modalStep2">
            <h2 class="modal-heading">Select a product</h2>
            <div class="modal-results" id="modalResults"></div>
            <div class="modal-footer-row">
              <button class="modal-btn-back" id="step2Back">← Back</button>
            </div>
          </div>

          <div class="modal-step" id="modalStep3">
            <h2 class="modal-heading">Set your target price</h2>
            <div class="modal-selected-product" id="modalSelectedProduct"></div>
            <div class="modal-field">
              <label class="modal-label" for="modalPriceInput">Alert me when the price drops below:</label>
              <div class="modal-price-wrap">
                <span class="modal-price-symbol">$</span>
                <input type="number" class="modal-input modal-price-input" id="modalPriceInput" min="1" step="1" placeholder="0">
              </div>
              <span class="modal-field-error" id="priceError"></span>
            </div>
            <div class="modal-field">
              <label class="modal-label" for="modalEmailInput">Your email address</label>
              <input type="email" class="modal-input" id="modalEmailInput"
                placeholder="you@example.com" autocomplete="email">
              <span class="modal-field-error" id="emailError"></span>
              <span class="modal-field-hint">We'll send a one-time confirmation email. No spam, ever.</span>
            </div>
            <div style="position:absolute;left:-9999px;opacity:0;" aria-hidden="true">
              <label for="modalHoneypot">Website (leave blank)</label>
              <input type="text" id="modalHoneypot" name="website" tabindex="-1" autocomplete="off">
            </div>
            <div class="cf-turnstile" data-sitekey="0x4AAAAAADTmp79GaQVF5cAu" data-theme="auto" style="margin-top:12px;"></div>
            <span class="modal-field-error" id="submitError"></span>
            <div class="modal-footer-row">
              <button class="modal-btn-back" id="step3Back">← Back</button>
              <button class="modal-btn-primary" id="modalSetAlertBtn">Set Alert</button>
            </div>
          </div>

          <div class="modal-step" id="modalStep4">
            <div class="modal-success">
              <div class="modal-success-icon">
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                  <circle cx="16" cy="16" r="15" stroke="#2563eb" stroke-width="2"/>
                  <path d="M9 16.5l5 5 9-10" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <h2 class="modal-heading">Almost there.</h2>
              <p class="modal-success-text" id="modalSuccessText"></p>
              <p class="modal-success-hint">Once you confirm, we'll check the price daily and email you when your target is hit.</p>
            </div>
            <div class="modal-success-actions">
              <button class="modal-btn-secondary" id="modalTrackAnotherBtn">Track another product</button>
              <button class="modal-btn-primary" id="modalDoneBtn">Close</button>
            </div>
          </div>

        </div>
      </div>
    `;
    document.body.appendChild(el);
  }

  function goToStep(n) {
    document.getElementById('modalStep' + currentStep).classList.remove('active');
    currentStep = n;
    document.getElementById('modalStep' + n).classList.add('active');
    updateProgress();
    setTimeout(function () {
      var step = document.getElementById('modalStep' + n);
      var first = step.querySelector('input, button');
      if (first) first.focus();
    }, 50);
  }

  function updateProgress() {
    document.getElementById('modalStepLabel').textContent = 'Step ' + currentStep + ' of 4';
    document.querySelectorAll('.modal-dot').forEach(function (dot, i) {
      dot.classList.toggle('active', i + 1 <= currentStep);
    });
  }

  function doSearch() {
    var query = document.getElementById('modalSearchInput').value.trim();
    if (!query) { document.getElementById('modalSearchInput').focus(); return; }
    if (!window.memradarSearch) return;
    window.memradarSearch.loadIndex(function () {
      lastResults = window.memradarSearch.search(query).slice(0, 6);
      renderResults(query);
      goToStep(2);
    });
  }

  function renderResults(query) {
    var container = document.getElementById('modalResults');
    if (!lastResults.length) {
      container.innerHTML = '<p class="modal-no-results">No products match “' + esc(query) + '”. Try another search.</p>';
      return;
    }
    container.innerHTML = lastResults.map(function (p) {
      var catLabel = p.category === 'ram' ? 'RAM' : 'SSD';
      return '<button class="modal-result-card" data-sku="' + esc(p.sku) + '" aria-label="Select ' + esc(p.name) + '">' +
        '<div class="modal-result-info">' +
          '<span class="modal-badge modal-badge--' + esc(p.category) + '">' + catLabel + '</span>' +
          '<span class="modal-result-name">' + esc(p.name) + '</span>' +
          '<span class="modal-result-price">' + money(p.current_price) + '</span>' +
        '</div>' +
        '<svg class="modal-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none">' +
          '<path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>' +
      '</button>';
    }).join('');

    container.querySelectorAll('.modal-result-card').forEach(function (card) {
      card.addEventListener('click', function () {
        selectedProduct = lastResults.find(function (p) { return p.sku === card.dataset.sku; });
        var catLabel = selectedProduct.category === 'ram' ? 'RAM' : 'SSD';
        document.getElementById('modalSelectedProduct').innerHTML =
          '<span class="modal-badge modal-badge--' + esc(selectedProduct.category) + '">' + catLabel + '</span>' +
          '<span class="modal-selected-name">' + esc(selectedProduct.name) + '</span>';
        var suggested = selectedProduct.current_price ? Math.max(1, Math.floor(selectedProduct.current_price * 0.9)) : '';
        document.getElementById('modalPriceInput').value = suggested;
        document.getElementById('priceError').textContent = '';
        document.getElementById('emailError').textContent = '';
        document.getElementById('submitError').textContent = '';
        goToStep(3);
      });
    });
  }

  function validate() {
    var valid = true;
    var price = parseFloat(document.getElementById('modalPriceInput').value);
    var email = document.getElementById('modalEmailInput').value.trim();
    document.getElementById('priceError').textContent = '';
    document.getElementById('emailError').textContent = '';
    if (!price || price <= 0) {
      document.getElementById('priceError').textContent = 'Please enter a valid price greater than $0.';
      valid = false;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      document.getElementById('emailError').textContent = 'Please enter a valid email address.';
      valid = false;
    }
    return valid;
  }

  function openModal() {
    document.querySelectorAll('.modal-step').forEach(function (s) { s.classList.remove('active'); });
    currentStep = 1;
    document.getElementById('modalStep1').classList.add('active');
    updateProgress();
    document.getElementById('modalSearchInput').value = '';
    document.getElementById('modalEmailInput').value = '';
    document.getElementById('modalPriceInput').value = '';
    selectedProduct = null;
    lastResults = [];
    if (window.memradarSearch) window.memradarSearch.loadIndex(function () {});
    window.memradarAlert.ensureTurnstile();
    document.getElementById('alertModal').classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(function () { document.getElementById('modalSearchInput').focus(); }, 100);
  }

  // Open pre-filled for a known product (e.g. a "Track Price" button), jumping
  // straight to the target-price step. product: { sku, name, category, current_price }.
  function openForProduct(product) {
    if (!product || !product.sku) { openModal(); return; }
    document.querySelectorAll('.modal-step').forEach(function (s) { s.classList.remove('active'); });
    selectedProduct = product;
    lastResults = [];
    var catLabel = product.category === 'ram' ? 'RAM' : 'SSD';
    document.getElementById('modalSelectedProduct').innerHTML =
      '<span class="modal-badge modal-badge--' + esc(product.category) + '">' + catLabel + '</span>' +
      '<span class="modal-selected-name">' + esc(product.name) + '</span>';
    document.getElementById('modalPriceInput').value = product.current_price
      ? Math.max(1, Math.floor(product.current_price * 0.9)) : '';
    document.getElementById('modalEmailInput').value = '';
    document.getElementById('priceError').textContent = '';
    document.getElementById('emailError').textContent = '';
    document.getElementById('submitError').textContent = '';
    currentStep = 3;
    document.getElementById('modalStep3').classList.add('active');
    updateProgress();
    if (window.memradarSearch) window.memradarSearch.loadIndex(function () {});
    window.memradarAlert.ensureTurnstile();
    document.getElementById('alertModal').classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(function () { document.getElementById('modalEmailInput').focus(); }, 100);
  }

  function closeModal() {
    document.getElementById('alertModal').classList.remove('open');
    document.body.style.overflow = '';
  }

  function trapFocus(e) {
    if (!document.getElementById('alertModal').classList.contains('open')) return;
    if (e.key === 'Escape') { closeModal(); return; }
    if (e.key !== 'Tab') return;
    var card = document.getElementById('modalCard');
    var focusable = Array.prototype.slice.call(card.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function submitAlert() {
    if (!selectedProduct) return;
    if (!validate()) return;
    if (document.getElementById('modalHoneypot').value) return; // bot
    var submitError = document.getElementById('submitError');
    submitError.textContent = '';

    var token = window.memradarAlert.turnstileToken(document.getElementById('modalStep3'));
    if (!token) { submitError.textContent = 'Please complete the “I’m human” check.'; return; }

    var price = parseFloat(document.getElementById('modalPriceInput').value);
    var email = document.getElementById('modalEmailInput').value.trim();
    var btn = document.getElementById('modalSetAlertBtn');
    btn.disabled = true; btn.textContent = 'Setting…';

    window.memradarAlert.submit({
      email: email,
      targetPrice: price,
      productId: selectedProduct.sku,
      website: '',
      turnstileToken: token
    }).then(function (r) {
      btn.disabled = false; btn.textContent = 'Set Alert';
      if (r.status === 400 && r.data && r.data.errors) {
        submitError.textContent = r.data.errors.join(' ');
        return;
      }
      if (r.ok && r.data && r.data.success) {
        document.getElementById('modalSuccessText').innerHTML =
          'Check your email at <strong>' + esc(email) + '</strong> to confirm your alert for <strong>' + esc(selectedProduct.name) + '</strong>.';
        goToStep(4);
        return;
      }
      submitError.textContent = 'Something went wrong. Please try again in a moment.';
    }).catch(function () {
      btn.disabled = false; btn.textContent = 'Set Alert';
      submitError.textContent = 'Network error. Your details are still here. Please try again.';
    });
  }

  function init() {
    buildModal();

    document.querySelectorAll('.btn-alert').forEach(function (btn) {
      btn.addEventListener('click', function (e) { e.preventDefault(); openModal(); });
    });

    document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
    document.getElementById('alertModal').addEventListener('click', function (e) {
      if (e.target === e.currentTarget) closeModal();
    });

    document.getElementById('modalSearchBtn').addEventListener('click', doSearch);
    document.getElementById('modalSearchInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doSearch();
    });

    document.getElementById('step2Back').addEventListener('click', function () { goToStep(1); });
    // If we arrived at step 3 without a search (openForProduct), Back goes home.
    document.getElementById('step3Back').addEventListener('click', function () { goToStep(lastResults.length ? 2 : 1); });
    document.getElementById('modalSetAlertBtn').addEventListener('click', submitAlert);

    document.getElementById('modalTrackAnotherBtn').addEventListener('click', function () {
      document.getElementById('modalSearchInput').value = '';
      document.getElementById('modalEmailInput').value = '';
      selectedProduct = null;
      goToStep(1);
    });
    document.getElementById('modalDoneBtn').addEventListener('click', closeModal);

    document.addEventListener('keydown', trapFocus);
  }

  // Public API for other scripts (e.g. home-drops.js "Track Price").
  window.memradarAlertModal = { open: openModal, openForProduct: openForProduct };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
