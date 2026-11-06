/**
 * My Pet — storefront behaviour for the my-pet.liquid block.
 * Upload a pet photo → image-edit the published design → preview on the
 * garment → add to cart via the same shadow-SKU endpoint every other
 * customizer flow uses. See docs/ (My Pet plan) for the full spec.
 */
(function () {
  'use strict';
  var TAG = '[My Pet]';

  function proxyPath(path) {
    return '/apps/appai/' + path.replace(/^\//, '');
  }

  function postJson(path, body) {
    return fetch(proxyPath(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body || {}),
    }).then(function (r) { return r.json(); });
  }

  function getJson(path, params) {
    var qs = params
      ? '?' + Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&')
      : '';
    return fetch(proxyPath(path) + qs, { credentials: 'same-origin' }).then(function (r) { return r.json(); });
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function applyThemeVars(root) {
    try {
      var primary = document.querySelector(
        'button[name="add"], .product-form__submit, button.btn--primary, .btn--filled, ' +
        'button.button--primary, .product-form button[type="submit"], button[type="submit"]'
      );
      if (!primary) return;
      var cs = getComputedStyle(primary);
      // Outline/secondary look derived from the primary button's own colour and
      // shape — most themes have no dedicated secondary button on the PDP at all.
      root.style.setProperty('--appai-my-pet-bg', 'transparent');
      root.style.setProperty('--appai-my-pet-fg', cs.backgroundColor);
      root.style.setProperty('--appai-my-pet-border', cs.backgroundColor);
      root.style.setProperty('--appai-my-pet-radius', cs.borderRadius);
      // Intentionally NOT setting --appai-my-pet-caption-fg: the primary
      // button's text color is its *inside* color (white on a black Add to
      // cart), which painted the caption invisible on white page backgrounds.
      // The CSS fallback (#666666 gray) reads on both light and dark themes.
      var btn = root.querySelector('.appai-my-pet__button');
      if (btn) {
        btn.style.fontFamily = cs.fontFamily;
        btn.style.fontWeight = cs.fontWeight;
        btn.style.letterSpacing = cs.letterSpacing;
        btn.style.textTransform = cs.textTransform;
      }
    } catch (e) {
      console.warn(TAG, 'theme sampling failed', e);
    }
  }

  function findOptionValue(variant, optionNames, wantedNames) {
    for (var i = 0; i < optionNames.length; i++) {
      var name = String(optionNames[i] || '').toLowerCase();
      if (wantedNames.indexOf(name) === -1) continue;
      var key = 'option' + (i + 1);
      if (variant[key] != null) return variant[key];
    }
    return null;
  }

  function currentVariantInfo(root) {
    var variants = [];
    var optionNames = [];
    try { variants = JSON.parse(root.getAttribute('data-variants') || '[]'); } catch (e) {}
    try { optionNames = (root.getAttribute('data-option-names') || '').split('::'); } catch (e) {}
    var form = document.querySelector('form[action*="/cart/add"]');
    var idInput = form ? form.querySelector('input[name="id"], select[name="id"]') : null;
    var variantId = idInput ? idInput.value : root.getAttribute('data-selected-variant');
    var variant = null;
    for (var i = 0; i < variants.length; i++) {
      if (String(variants[i].id) === String(variantId)) { variant = variants[i]; break; }
    }
    if (!variant) return { variantId: variantId, colorName: null, sizeId: null, price: null };
    var colorName = findOptionValue(variant, optionNames, ['color', 'colour']);
    var sizeId = findOptionValue(variant, optionNames, ['size']);
    return { variantId: variantId, colorName: colorName, sizeId: sizeId, price: variant.price != null ? (variant.price / 100).toFixed(2) : null };
  }

  function buildModal() {
    var overlay = document.createElement('div');
    overlay.className = 'appai-my-pet-modal__overlay';
    overlay.innerHTML =
      '<div class="appai-my-pet-modal">' +
      '  <button type="button" class="appai-my-pet-modal__close" aria-label="Close">&times;</button>' +
      '  <div class="appai-my-pet-modal__body"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.appai-my-pet-modal__close').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    return { overlay: overlay, body: overlay.querySelector('.appai-my-pet-modal__body') };
  }

  function injectModalStyles() {
    if (document.getElementById('appai-my-pet-modal-style')) return;
    var style = document.createElement('style');
    style.id = 'appai-my-pet-modal-style';
    style.textContent =
      '.appai-my-pet-modal__overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem;}' +
      '.appai-my-pet-modal{background:#fff;border-radius:8px;max-width:420px;width:100%;max-height:90vh;overflow:auto;position:relative;padding:1.5rem;}' +
      '.appai-my-pet-modal__close{position:absolute;top:0.5rem;right:0.75rem;background:none;border:none;font-size:1.5rem;cursor:pointer;line-height:1;}' +
      '.appai-my-pet-modal__body img{width:100%;border-radius:6px;display:block;margin:0.75rem 0;}' +
      '.appai-my-pet-modal__body button.appai-primary{display:block;width:100%;padding:0.75em;margin-top:0.5rem;border-radius:4px;border:none;background:#111;color:#fff;font-weight:600;cursor:pointer;}' +
      '.appai-my-pet-modal__body button.appai-secondary{display:block;width:100%;padding:0.75em;margin-top:0.5rem;border-radius:4px;border:1px solid #ccc;background:#fff;color:#111;cursor:pointer;}' +
      '.appai-my-pet-modal__body input[type=email]{display:block;width:100%;padding:0.6em;margin-top:0.5rem;border:1px solid #ccc;border-radius:4px;}' +
      '.appai-my-pet-modal__body .appai-my-pet-msg{color:#444;text-align:center;}' +
      '.appai-my-pet-modal__body label{display:flex;align-items:center;gap:0.4em;font-size:0.85em;margin-top:0.5em;}';
    document.head.appendChild(style);
  }

  function init(root) {
    injectModalStyles();
    applyThemeVars(root);

    var candidateId = root.getAttribute('data-candidate-id');
    var shopifyProductId = root.getAttribute('data-product-id');
    var pageUrl = root.getAttribute('data-page-url') || window.location.href;
    var openBtn = root.querySelector('[data-appai-my-pet-open]');
    if (!openBtn) return;

    var state = { renderId: null, jobId: null, emailPrompted: false };

    function showMessage(body, message) {
      body.innerHTML = '<p class="appai-my-pet-msg">' + message + '</p>';
    }

    function openUploadStep() {
      var picker = buildModal();
      picker.body.innerHTML =
        '<h3>Add your pet</h3>' +
        '<p class="appai-my-pet-msg">Choose a clear photo of your pet.</p>' +
        '<input type="file" accept="image/*" class="appai-my-pet-file" />';
      var input = picker.body.querySelector('.appai-my-pet-file');
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;
        showMessage(picker.body, 'Uploading your photo…');
        fileToDataUrl(file)
          .then(function (dataUrl) { return postJson('my-pet/upload-photo', { imageData: dataUrl }); })
          .then(function (uploadRes) {
            if (!uploadRes || !uploadRes.ok) throw new Error((uploadRes && uploadRes.error) || 'Could not upload photo');
            showMessage(picker.body, 'Creating your design…');
            var info = currentVariantInfo(root);
            return postJson('my-pet/generate', {
              candidateId: candidateId,
              shopifyProductId: shopifyProductId,
              photoId: uploadRes.photoId,
              colorName: info.colorName,
              sizeId: info.sizeId,
            });
          })
          .then(function (genRes) {
            if (!genRes || !genRes.ok) {
              showMessage(picker.body, (genRes && genRes.message) || (genRes && genRes.error) || 'We could not create this design. Please try again.');
              return;
            }
            state.renderId = genRes.renderId;
            state.jobId = genRes.jobId;
            state.emailPrompted = false;
            picker.overlay.remove();
            openPreviewStep(genRes.previewUrl);
          })
          .catch(function (err) {
            showMessage(picker.body, err && err.message ? err.message : 'Something went wrong. Please try again.');
          });
      });
    }

    function openPreviewStep(previewUrl) {
      var modal = buildModal();
      renderPreviewBody(modal.body, previewUrl);
      watchVariantChange(modal.body);
    }

    function renderPreviewBody(body, previewUrl) {
      body.innerHTML =
        '<h3>Your design</h3>' +
        '<img src="' + previewUrl + '" alt="Your pet on this design" />' +
        '<button type="button" class="appai-primary" data-action="add-to-cart">Add to cart</button>' +
        '<button type="button" class="appai-secondary" data-action="change-photo">Try another photo</button>' +
        '<p id="appai-my-pet-status" class="appai-my-pet-msg"></p>';
      body.querySelector('[data-action="add-to-cart"]').addEventListener('click', function () { addToCart(body); });
      body.querySelector('[data-action="change-photo"]').addEventListener('click', function () {
        body.closest('.appai-my-pet-modal__overlay').remove();
        openUploadStep();
      });
    }

    function watchVariantChange(body) {
      var last = currentVariantInfo(root);
      var timer = setInterval(function () {
        if (!document.body.contains(body)) { clearInterval(timer); return; }
        var now = currentVariantInfo(root);
        if (now.colorName && now.colorName !== last.colorName && state.renderId) {
          last = now;
          var status = body.querySelector('#appai-my-pet-status');
          if (status) status.textContent = 'Updating colour…';
          postJson('my-pet/recomposite', { renderId: state.renderId, colorName: now.colorName })
            .then(function (res) {
              if (res && res.ok) {
                var img = body.querySelector('img');
                if (img) img.src = res.previewUrl;
              }
              if (status) status.textContent = '';
            })
            .catch(function () { if (status) status.textContent = ''; });
        } else {
          last = now;
        }
      }, 600);
    }

    function addToCart(body) {
      var status = body.querySelector('#appai-my-pet-status');
      var info = currentVariantInfo(root);
      if (status) status.textContent = 'Adding to cart…';
      postJson('my-pet/resolve-variant', { renderId: state.renderId, variantId: info.variantId, price: info.price })
        .then(function (res) {
          if (!res || !res.success || !res.variantId) {
            throw new Error('This design isn\'t ready yet. Please try again.');
          }
          return fetch('/cart/add.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: [{ id: res.variantId, quantity: 1 }] }),
          }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, json: j }; }); });
        })
        .then(function (added) {
          if (!added.ok) throw new Error((added.json && added.json.description) || 'Could not add to cart');
          if (status) {
            status.innerHTML = 'Added to cart! <a href="/cart">View cart</a>';
          }
          document.dispatchEvent(new CustomEvent('cart:refresh'));
        })
        .catch(function (err) {
          if (status) status.textContent = err && err.message ? err.message : 'Could not add to cart. Please try again.';
        });
    }

    function maybePromptEmailSave() {
      if (!state.renderId || state.emailPrompted) return;
      state.emailPrompted = true;
      var modal = buildModal();
      modal.body.innerHTML =
        '<h3>Save your design?</h3>' +
        '<p class="appai-my-pet-msg">We\'ll email you a link back to it — works for 30 days, on any device.</p>' +
        '<input type="email" placeholder="you@example.com" class="appai-my-pet-email" />' +
        '<label><input type="checkbox" class="appai-my-pet-consent" checked /> Keep me posted about new designs</label>' +
        '<button type="button" class="appai-primary" data-action="send">Email me this design</button>' +
        '<p id="appai-my-pet-email-status" class="appai-my-pet-msg"></p>';
      modal.body.querySelector('[data-action="send"]').addEventListener('click', function () {
        var email = modal.body.querySelector('.appai-my-pet-email').value;
        var consent = modal.body.querySelector('.appai-my-pet-consent').checked;
        var status = modal.body.querySelector('#appai-my-pet-email-status');
        status.textContent = 'Sending…';
        postJson('my-pet/email-save', { renderId: state.renderId, email: email, marketingConsent: consent, pageUrl: pageUrl })
          .then(function (res) {
            status.textContent = res && res.ok ? 'Sent! Check your inbox.' : (res && res.error) || 'Could not send email.';
          })
          .catch(function () { status.textContent = 'Could not send email.'; });
      });
    }

    // Desktop exit-intent (mouse leaving toward the browser chrome). Mobile has
    // no reliable equivalent — visibilitychange only fires once the page is
    // already hidden, too late to show new UI, so this is a best-effort nudge.
    document.addEventListener('mouseleave', function (e) {
      if (e.clientY <= 0) maybePromptEmailSave();
    });

    // Email-saved link resume: ?my_pet_token=... loads that render directly,
    // cross-device, no re-upload (valid 30 days).
    try {
      var tokenParam = new URL(window.location.href).searchParams.get('my_pet_token');
      if (tokenParam) {
        getJson('my-pet/resolve-token', { token: tokenParam }).then(function (res) {
          if (res && res.ok) {
            state.renderId = res.renderId;
            openPreviewStep(res.previewUrl);
          }
        });
      }
    } catch (e) {}

    openBtn.addEventListener('click', function () {
      if (state.renderId) {
        // Already generated this visit — reopen the preview, don't re-spend a cap attempt.
        getJson('my-pet/cap-status', { productId: shopifyProductId }); // keep session warm; ignore result here
        return;
      }
      getJson('my-pet/cap-status', { productId: shopifyProductId })
        .then(function (cap) {
          if (cap && cap.allowed === false) {
            var modal = buildModal();
            showMessage(modal.body, cap.message || 'You have used your My Pet tries on this design.');
            return;
          }
          openUploadStep();
        })
        .catch(function () { openUploadStep(); });
    });
  }

  function boot() {
    var roots = document.querySelectorAll('.appai-my-pet');
    for (var i = 0; i < roots.length; i++) init(roots[i]);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();
