/**
 * Select size M on a fresh product page when the URL has no ?variant=.
 * Sets the size radio and dispatches change. Does not focus, so the page
 * does not jump, and does not touch colour swatches.
 */
(function () {
  if (window.__appaiDefaultSizeM) return;
  window.__appaiDefaultSizeM = true;

  function variantInUrl() {
    return /(?:^|[?&])variant=/.test(window.location.search);
  }

  function isSizeRadio(radio) {
    var name = String(radio.name || '').toLowerCase();
    if (name.indexOf('size') !== -1 && name.indexOf('color') === -1 && name.indexOf('colour') === -1) return true;
    var box = radio.closest ? radio.closest('fieldset, [data-option-name]') : null;
    if (!box) return false;
    var ctx = String(box.getAttribute('data-option-name') || box.getAttribute('data-option') || '').toLowerCase();
    var legend = box.querySelector ? box.querySelector('legend') : null;
    if (legend) ctx += ' ' + String(legend.textContent || '').toLowerCase();
    if (ctx.indexOf('color') !== -1 || ctx.indexOf('colour') !== -1) return false;
    return ctx.indexOf('size') !== -1;
  }

  function selectMedium() {
    if (variantInUrl()) return;
    var radios = document.querySelectorAll('input[type="radio"]');
    var target = null;
    for (var i = 0; i < radios.length; i++) {
      var radio = radios[i];
      if (!isSizeRadio(radio)) continue;
      if (String(radio.value || '').trim().toUpperCase() !== 'M') continue;
      if (radio.disabled) continue;
      target = radio;
      break;
    }
    if (!target || target.checked) return;
    window.__appaiSelectingDefaultSize = true;
    try {
      target.checked = true;
      target.dispatchEvent(new Event('change', { bubbles: true }));
    } finally {
      window.__appaiSelectingDefaultSize = false;
    }
  }

  function start() {
    selectMedium();
    setTimeout(selectMedium, 400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
