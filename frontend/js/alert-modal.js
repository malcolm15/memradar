(function () {
  let currentStep = 1;
  let selectedProduct = null;

  const MOCK_PRODUCTS = [
    { id: 1, name: 'G.Skill Trident Z5 RGB DDR5-6000 32GB (2×16GB)', brand: 'G.Skill', category: 'RAM', defaultPrice: 289 },
    { id: 2, name: 'Samsung 990 Pro 2TB NVMe M.2 SSD', brand: 'Samsung', category: 'SSD', defaultPrice: 169 },
    { id: 3, name: 'Crucial Pro DDR5-5600 32GB (2×16GB)', brand: 'Crucial', category: 'RAM', defaultPrice: 249 },
    { id: 4, name: 'WD Black SN850X 1TB NVMe M.2 SSD', brand: 'WD', category: 'SSD', defaultPrice: 99 },
  ];

  function buildModal() {
    const el = document.createElement('div');
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
              <span class="modal-field-hint">We'll send you a one-time email when this price is hit. No spam, ever.</span>
            </div>
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
              <h2 class="modal-heading">You're on the radar.</h2>
              <p class="modal-success-text" id="modalSuccessText"></p>
              <p class="modal-success-hint">Prices are checked daily. You'll only be emailed once when your target is hit.</p>
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
    document.getElementById(`modalStep${currentStep}`).classList.remove('active');
    currentStep = n;
    document.getElementById(`modalStep${n}`).classList.add('active');
    updateProgress();
    setTimeout(() => {
      const step = document.getElementById(`modalStep${n}`);
      const first = step.querySelector('input, button');
      if (first) first.focus();
    }, 50);
  }

  function updateProgress() {
    document.getElementById('modalStepLabel').textContent = `Step ${currentStep} of 4`;
    document.querySelectorAll('.modal-dot').forEach((dot, i) => {
      dot.classList.toggle('active', i + 1 <= currentStep);
    });
  }

  function renderResults() {
    const container = document.getElementById('modalResults');
    container.innerHTML = MOCK_PRODUCTS.map(p => `
      <button class="modal-result-card" data-id="${p.id}" aria-label="Select ${p.name}">
        <div class="modal-result-info">
          <span class="modal-badge modal-badge--${p.category.toLowerCase()}">${p.category}</span>
          <span class="modal-result-name">${p.name}</span>
          <span class="modal-result-price">$—</span>
        </div>
        <svg class="modal-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    `).join('');

    container.querySelectorAll('.modal-result-card').forEach(card => {
      card.addEventListener('click', () => {
        selectedProduct = MOCK_PRODUCTS.find(p => p.id === parseInt(card.dataset.id));
        document.getElementById('modalSelectedProduct').innerHTML = `
          <span class="modal-badge modal-badge--${selectedProduct.category.toLowerCase()}">${selectedProduct.category}</span>
          <span class="modal-selected-name">${selectedProduct.name}</span>
        `;
        document.getElementById('modalPriceInput').value = selectedProduct.defaultPrice;
        document.getElementById('priceError').textContent = '';
        document.getElementById('emailError').textContent = '';
        goToStep(3);
      });
    });
  }

  function validate() {
    let valid = true;
    const price = parseFloat(document.getElementById('modalPriceInput').value);
    const email = document.getElementById('modalEmailInput').value.trim();
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
    document.querySelectorAll('.modal-step').forEach(s => s.classList.remove('active'));
    currentStep = 1;
    document.getElementById('modalStep1').classList.add('active');
    updateProgress();
    document.getElementById('modalSearchInput').value = '';
    document.getElementById('modalEmailInput').value = '';
    document.getElementById('modalPriceInput').value = '';
    selectedProduct = null;
    document.getElementById('alertModal').classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('modalSearchInput').focus(), 100);
  }

  function closeModal() {
    document.getElementById('alertModal').classList.remove('open');
    document.body.style.overflow = '';
  }

  function trapFocus(e) {
    if (!document.getElementById('alertModal').classList.contains('open')) return;
    if (e.key === 'Escape') { closeModal(); return; }
    if (e.key !== 'Tab') return;
    const card = document.getElementById('modalCard');
    const focusable = Array.from(card.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function init() {
    buildModal();

    document.querySelectorAll('.btn-alert').forEach(btn =>
      btn.addEventListener('click', e => { e.preventDefault(); openModal(); })
    );

    document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
    document.getElementById('alertModal').addEventListener('click', e => {
      if (e.target === e.currentTarget) closeModal();
    });

    document.getElementById('modalSearchBtn').addEventListener('click', () => {
      if (!document.getElementById('modalSearchInput').value.trim()) {
        document.getElementById('modalSearchInput').focus();
        return;
      }
      renderResults();
      goToStep(2);
    });
    document.getElementById('modalSearchInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('modalSearchBtn').click();
    });

    document.getElementById('step2Back').addEventListener('click', () => goToStep(1));
    document.getElementById('step3Back').addEventListener('click', () => goToStep(2));

    document.getElementById('modalSetAlertBtn').addEventListener('click', () => {
      if (!validate()) return;
      const price = parseFloat(document.getElementById('modalPriceInput').value);
      const email = document.getElementById('modalEmailInput').value.trim();
      // TODO: Add server-side rate limiting (max 3 submissions per IP per hour) before production launch
      console.log('Alert queued for Supabase:', { product: selectedProduct, targetPrice: price, email });
      document.getElementById('modalSuccessText').innerHTML =
        `We'll email you at <strong>${email}</strong> when <strong>${selectedProduct.name}</strong> drops below $${price.toFixed(0)}.`;
      goToStep(4);
    });

    document.getElementById('modalTrackAnotherBtn').addEventListener('click', () => {
      document.getElementById('modalSearchInput').value = '';
      document.getElementById('modalEmailInput').value = '';
      selectedProduct = null;
      goToStep(1);
    });
    document.getElementById('modalDoneBtn').addEventListener('click', closeModal);

    document.addEventListener('keydown', trapFocus);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
