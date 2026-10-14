// Record citation copy buttons, on /price-index/ and every month page.
// Progressive enhancement: the buttons ship hidden and are shown only where the
// clipboard API exists, so without JS the three forms are still there to select.
// Copy source puts the record name as plain text with its URL, and as an HTML
// link, on the clipboard; Copy finding puts the sentence as plain text only.
(function () {
  var box = document.getElementById('pimCitation');
  if (!box || !navigator.clipboard || !navigator.clipboard.writeText) return;
  var status = document.getElementById('pimCopyStatus');
  function say(t) { if (status) status.textContent = t; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function copySource(btn) {
    var plain = btn.getAttribute('data-plain');
    var a = document.getElementById('pimCiteSourceLink');
    // The canonical record URL, never the origin the page happens to be served from.
    var html = '<a href="' + esc(btn.getAttribute('data-url')) + '">' + esc(a.textContent.trim()) + '</a>';
    if (window.ClipboardItem && navigator.clipboard.write) {
      var item = new ClipboardItem({
        'text/plain': new Blob([plain], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      });
      return navigator.clipboard.write([item]).catch(function () { return navigator.clipboard.writeText(plain); });
    }
    return navigator.clipboard.writeText(plain);
  }
  var buttons = box.querySelectorAll('.pim-copy[data-copy]');
  for (var i = 0; i < buttons.length; i++) {
    (function (btn) {
      btn.hidden = false;
      btn.addEventListener('click', function () {
        var kind = btn.getAttribute('data-copy');
        var done = kind === 'source' ? copySource(btn)
          : navigator.clipboard.writeText(document.getElementById('pimCiteFinding').textContent.trim());
        done.then(function () { say(kind === 'source' ? 'Source copied' : 'Finding copied'); },
          function () { say('Select the text above to copy it'); });
      });
    })(buttons[i]);
  }
})();
