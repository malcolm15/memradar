// PDP inline price-alert form handler. Posts to the alerts API (cross-origin
// to the Vercel domain). Uses window.memradarAlert (defined in alert-modal.js,
// which is included on every page including PDPs).
(function () {
  var form = document.getElementById('pdpAlertForm');
  var success = document.getElementById('pdpAlertSuccess');
  if (!form || !window.memradarAlert) return;

  var submitBtn = form.querySelector('.pdp-alert-submit-btn');

  function showError(msg) {
    var err = form.querySelector('.pdp-alert-error');
    if (!err) {
      err = document.createElement('p');
      err.className = 'pdp-alert-error';
      err.setAttribute('role', 'alert');
      form.querySelector('.pdp-alert-disclaimer').insertAdjacentElement('beforebegin', err);
    }
    err.textContent = msg;
  }
  function clearError() {
    var err = form.querySelector('.pdp-alert-error');
    if (err) err.textContent = '';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearError();
    if (document.getElementById('pdpHoneypot').value) return; // bot

    var price = document.getElementById('pdpAlertPrice').value;
    var email = document.getElementById('pdpAlertEmail').value.trim();
    if (!price || !email) { showError('Please enter your email and a target price.'); return; }

    var token = window.memradarAlert.turnstileToken(form);
    if (!token) { showError('Please complete the “I’m human” check.'); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Setting…';

    window.memradarAlert.submit({
      email: email,
      targetPrice: parseFloat(price),
      productId: form.dataset.sku,
      website: '',
      turnstileToken: token
    }).then(function (r) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Set Alert';
      if (r.status === 400 && r.data && r.data.errors) {
        showError(r.data.errors.join(' '));
        return;
      }
      if (r.ok && r.data && r.data.success) {
        form.style.display = 'none';
        if (success) success.hidden = false;
        return;
      }
      showError('Something went wrong. Please try again in a moment.');
    }).catch(function () {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Set Alert';
      showError('Network error. Your details are still here. Please try again.');
    });
  });
})();
