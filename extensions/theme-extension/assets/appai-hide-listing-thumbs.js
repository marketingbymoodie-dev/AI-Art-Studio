/**
 * App-published listings: hide the theme thumbnail strip under the main
 * image. Colour stays on the swatches, which still change the hero.
 * The strip is the theme's slideshow-controls (Horizon) or thumbnail-list
 * (Dawn). My Pet hides the same strip only after a pet preview is showing,
 * and it also freezes the slideshow. This does not.
 */
(function (root) {
  var HIDE_CSS = [
    "media-gallery[data-appai-hide-thumbs] slideshow-component > slideshow-controls,",
    "media-gallery[data-appai-hide-thumbs] slideshow-component > slideshow-arrows,",
    "media-gallery[data-appai-hide-thumbs] slideshow-component > .slideshow-controls,",
    "media-gallery[data-appai-hide-thumbs] .thumbnail-slider,",
    "media-gallery[data-appai-hide-thumbs] .thumbnail-list,",
    "product-media-gallery[data-appai-hide-thumbs] slideshow-component > slideshow-controls,",
    "product-media-gallery[data-appai-hide-thumbs] slideshow-component > slideshow-arrows,",
    "product-media-gallery[data-appai-hide-thumbs] .thumbnail-slider,",
    "product-media-gallery[data-appai-hide-thumbs] .thumbnail-list",
    "{display:none !important;}"
  ].join("");

  function mainGallery(doc) {
    var picker = doc.querySelector("variant-picker, variant-radios, [data-variant-picker]");
    var section = picker && picker.closest
      ? picker.closest('[id^="shopify-section"], .shopify-section, product-info, section')
      : null;
    var scope = section || doc;
    return scope.querySelector("media-gallery, product-media-gallery");
  }

  function apply(doc) {
    var gallery = mainGallery(doc);
    if (!gallery) return false;
    gallery.setAttribute("data-appai-hide-thumbs", "1");
    return true;
  }

  function isThumbClick(target) {
    if (!target || !target.closest) return false;
    if (!target.closest("[data-appai-hide-thumbs]")) return false;
    return !!target.closest("slideshow-controls, slideshow-arrows, .slideshow-controls, .thumbnail-list, .thumbnail-slider, button.slideshow-controls__thumbnail");
  }

  function install(doc) {
    if (!doc.getElementById("appai-hide-listing-thumbs")) {
      var style = doc.createElement("style");
      style.id = "appai-hide-listing-thumbs";
      style.textContent = HIDE_CSS;
      (doc.head || doc.documentElement).appendChild(style);
    }
    apply(doc);
    if (doc.__appaiHideThumbsClick) return;
    doc.__appaiHideThumbsClick = function (event) {
      if (!isThumbClick(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    doc.addEventListener("click", doc.__appaiHideThumbsClick, true);
    var gallery = mainGallery(doc);
    var watch = (gallery && gallery.closest && gallery.closest('[id^="shopify-section"], .shopify-section, product-info, section')) || doc.body;
    if (!watch || doc.__appaiHideThumbsObserver) return;
    doc.__appaiHideThumbsObserver = new MutationObserver(function () { apply(doc); });
    doc.__appaiHideThumbsObserver.observe(watch, { childList: true, subtree: true });
  }

  var api = { apply: apply, install: install, isThumbClick: isThumbClick, mainGallery: mainGallery };
  root.AppaiHideListingThumbs = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (!root.document || root.__appaiHideListingThumbs) return;
  root.__appaiHideListingThumbs = true;
  if (root.document.readyState === "loading") {
    root.document.addEventListener("DOMContentLoaded", function () { install(root.document); });
  } else {
    install(root.document);
  }
})(typeof window !== "undefined" ? window : globalThis);
