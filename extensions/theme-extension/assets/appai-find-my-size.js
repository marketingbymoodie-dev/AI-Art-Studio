/**
 * Find my size on the product page. Styles are scoped under .appai-fms
 * with !important so the theme cannot restyle the buttons or hide the result.
 * The chest and length estimates match shared/findMySize.ts.
 */
(function (root) {
  var HEM_DROP = { closer: 0, relaxed: 1, oversized: 2 };

  function chestInches(heightCm, weightKg) {
    var heightMm = heightCm * 10;
    var weight = weightKg * 10;
    var male = 928.002 - 0.242 * heightMm + 0.622 * weight;
    var female = 916.48 - 0.282 * heightMm + 0.727 * weight;
    return (male + female) / 2 / 25.4;
  }

  function lengthInches(heightCm, fit) {
    var drop = HEM_DROP[fit];
    if (!(drop >= 0)) return null;
    return (heightCm / 2.54) * 0.42 + drop;
  }

  function columnByRole(columns, role) {
    var index;
    for (index = 0; index < columns.length; index += 1) {
      if (columns[index].role === role) return columns[index];
    }
    return null;
  }

  function smallestIndex(rows, valueOf, target) {
    var last = -1;
    var index;
    for (index = 0; index < rows.length; index += 1) {
      var value = valueOf(rows[index]);
      if (!(value > 0)) continue;
      last = index;
      if (value + 1e-9 >= target) return index;
    }
    return last;
  }

  function suggest(guide, heightCm, weightKg, fit) {
    var columns = (guide && guide.measurements && guide.measurements.columns) || [];
    var rows = (guide && guide.measurements && guide.measurements.rows) || [];
    var chest = columnByRole(columns, "chest");
    var length = columnByRole(columns, "length");
    var ease = (guide && guide.ease) || { closer: 2, relaxed: 4, oversized: 8 };
    if (!chest || !(Number(ease[fit]) >= 0) || !(heightCm > 0) || !(weightKg > 0)) return "";
    function at(height) {
      var body = chestInches(height, weightKg);
      var chestIndex = smallestIndex(rows, function (row) {
        return Number(row.values[chest.key]) * 2;
      }, body + Number(ease[fit]));
      var lengthTarget = lengthInches(height, fit);
      var lengthIndex = length && lengthTarget != null
        ? smallestIndex(rows, function (row) { return Number(row.values[length.key]); }, lengthTarget)
        : -1;
      if (chestIndex < 0) return lengthIndex;
      if (lengthIndex < 0) return chestIndex;
      return Math.max(chestIndex, lengthIndex);
    }
    var best = at(heightCm);
    if (best < 0) return "";
    var floor = Math.min(heightCm, 150);
    var height;
    for (height = floor; height < heightCm; height += 1) {
      var shorter = at(height);
      if (shorter > best) best = shorter;
    }
    return rows[best] ? rows[best].size : "";
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function garmentSvg(shape) {
    var tee = shape !== "long-sleeve" && shape !== "sweatshirt";
    var shoulder = 48;
    var hem = 162;
    var left = 72;
    var right = 148;
    var neckL = 98;
    var neckR = 122;
    var neckDip = 60;
    var armpit = 74;
    var sleeveTop = tee ? "M24 60 L72 48" : "M4 64 L72 48";
    var sleeveBottom = tee ? "L72 74 L34 86 Z" : "L72 74 L14 90 Z";
    var rightSleeve = tee
      ? "L196 60 L186 86 L148 74"
      : "L216 64 L206 90 L148 74";
    var body = sleeveTop
      + " L" + neckL + " " + shoulder
      + " Q110 " + neckDip + " " + neckR + " " + shoulder
      + " L" + right + " " + shoulder + " "
      + rightSleeve
      + " L" + right + " " + hem
      + " L" + left + " " + hem + " "
      + sleeveBottom;
    var hood = shape === "sweatshirt"
      ? '<path d="M88 48 C88 14 132 14 132 48" fill="none" stroke="#171717" stroke-width="1.5" stroke-linecap="round"/>'
      : "";
    var rib = shape === "sweatshirt"
      ? '<path d="M72 150 H148 M16 66 L24 88 M204 66 L196 88" fill="none" stroke="#171717" stroke-width="1.5" stroke-linecap="round"/>'
      : "";
    var arrowY = armpit + 14;
    var arrowX = tee ? 208 : 230;
    return '<svg class="appai-fms__svg" viewBox="0 0 260 190" width="238" height="174" aria-hidden="true">'
      + '<path d="' + body + '" fill="#f7f7f7" stroke="#171717" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>'
      + hood + rib
      + '<line x1="84" y1="' + arrowY + '" x2="136" y2="' + arrowY + '" stroke="#171717" stroke-width="1.25"/>'
      + '<path d="M84 ' + arrowY + ' l6 -3.5 M84 ' + arrowY + ' l6 3.5 M136 ' + arrowY + ' l-6 -3.5 M136 ' + arrowY + ' l-6 3.5" fill="none" stroke="#171717" stroke-width="1.25" stroke-linecap="round"/>'
      + '<text x="110" y="' + (arrowY - 6) + '" text-anchor="middle" font-size="12" fill="#171717" font-family="inherit">A</text>'
      + '<line x1="' + arrowX + '" y1="' + shoulder + '" x2="' + arrowX + '" y2="' + hem + '" stroke="#171717" stroke-width="1.25"/>'
      + '<path d="M' + arrowX + ' ' + shoulder + ' l-3.5 6 M' + arrowX + ' ' + shoulder + ' l3.5 6 M' + arrowX + ' ' + hem + ' l-3.5 -6 M' + arrowX + ' ' + hem + ' l3.5 -6" fill="none" stroke="#171717" stroke-width="1.25" stroke-linecap="round"/>'
      + '<text x="' + (arrowX + 8) + '" y="108" font-size="12" fill="#171717" font-family="inherit">B</text>'
      + "</svg>";
  }

  function choice(attr, value, label, pressed) {
    return '<button type="button" class="appai-fms__choice" ' + attr + '="' + escapeHtml(value) + '" aria-pressed="' + (pressed ? "true" : "false") + '">' + escapeHtml(label) + "</button>";
  }

  function sizeField(doc) {
    var fields = doc.querySelectorAll("fieldset, [data-option-name]");
    var index;
    for (index = 0; index < fields.length; index += 1) {
      var box = fields[index];
      if (box.closest && box.closest(".appai-fms")) continue;
      var text = String(box.textContent || "").toLowerCase();
      if (text.indexOf("size") !== -1 && text.indexOf("color") === -1 && text.indexOf("colour") === -1) return box;
    }
    return null;
  }

  function chooseSize(doc, name) {
    if (root.__appaiNoteSizeChosen) root.__appaiNoteSizeChosen();
    else root.__appaiSizeChosen = true;
    var wanted = String(name || "").trim().toLowerCase();
    var field = sizeField(doc) || doc;
    var radios = field.querySelectorAll('input[type="radio"]');
    var index;
    for (index = 0; index < radios.length; index += 1) {
      var radio = radios[index];
      var value = String(radio.value || "").trim().toLowerCase();
      var label = radio.closest ? radio.closest("label") : null;
      var text = label ? String(label.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() : "";
      if (value === wanted || text === wanted) {
        radio.click();
        radio.checked = true;
        radio.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    var buttons = field.querySelectorAll("button, label");
    for (index = 0; index < buttons.length; index += 1) {
      if (String(buttons[index].textContent || "").replace(/\s+/g, " ").trim().toLowerCase() === wanted) {
        buttons[index].click();
        return true;
      }
    }
    return false;
  }

  var styles = [
    ".appai-fms, .appai-fms * { box-sizing: border-box !important; }",
    ".appai-fms { position: fixed !important; inset: 0 !important; z-index: 2147483000 !important; background: rgba(0,0,0,.45) !important; display: flex !important; align-items: flex-end !important; justify-content: center !important; padding: 12px !important; font-family: var(--font-body--family, var(--font-body-family, inherit)) !important; }",
    ".appai-fms__panel { position: relative !important; background: #fff !important; color: #171717 !important; width: min(32rem, 100%) !important; max-height: 90vh !important; overflow: auto !important; border-radius: 10px !important; padding: 20px !important; font-family: var(--font-body--family, var(--font-body-family, inherit)) !important; font-size: 15px !important; line-height: 1.4 !important; text-align: left !important; }",
    ".appai-fms h2 { font-family: var(--font-body--family, var(--font-body-family, inherit)) !important; font-weight: 600 !important; font-style: normal !important; letter-spacing: normal !important; text-transform: none !important; line-height: 1.3 !important; padding-right: 28px !important; }",
    ".appai-fms h2, .appai-fms p, .appai-fms label, .appai-fms td, .appai-fms th { color: #171717 !important; background: transparent !important; margin: 0 0 8px !important; font-size: inherit !important; }",
    ".appai-fms__x { position: absolute !important; top: 8px !important; right: 8px !important; width: 32px !important; height: 32px !important; min-width: 0 !important; min-height: 0 !important; padding: 0 !important; margin: 0 !important; border: 0 !important; border-radius: 0 !important; background: transparent !important; color: #171717 !important; box-shadow: none !important; display: flex !important; align-items: center !important; justify-content: center !important; cursor: pointer !important; }",
    ".appai-fms__choice, .appai-fms__back, .appai-fms__primary, .appai-fms__use { appearance: none !important; display: inline-block !important; background: #fff !important; color: #171717 !important; border: 1px solid #171717 !important; border-radius: 6px !important; padding: 8px 12px !important; margin: 0 !important; min-height: 0 !important; min-width: 0 !important; width: auto !important; box-shadow: none !important; text-decoration: none !important; font: inherit !important; font-size: 14px !important; line-height: 1.2 !important; cursor: pointer !important; opacity: 1 !important; }",
    ".appai-fms__choice[aria-pressed='true'], .appai-fms__primary, .appai-fms__use { background: #171717 !important; color: #fff !important; }",
    ".appai-fms__row { display: flex !important; gap: 8px !important; margin: 0 0 12px !important; }",
    ".appai-fms__row > button { flex: 1 1 0 !important; }",
    ".appai-fms__primary, .appai-fms__use { width: 100% !important; margin-top: 8px !important; }",
    ".appai-fms input { display: block !important; width: 100% !important; margin-top: 4px !important; padding: 8px !important; border: 1px solid #171717 !important; border-radius: 6px !important; background: #fff !important; color: #171717 !important; font: inherit !important; }",
    ".appai-fms__svg { display: block !important; margin: 8px auto !important; width: 238px !important; height: 174px !important; max-width: 100% !important; }",
    ".appai-fms__caption { text-align: center !important; }",
    ".appai-fms__message { margin-top: 12px !important; padding: 12px !important; border: 1px solid #171717 !important; border-radius: 8px !important; }",
    ".appai-fms table { width: 100% !important; border-collapse: collapse !important; }",
    ".appai-fms td, .appai-fms th { padding: 4px 0 !important; }"
  ].join("");

  function openDialog(doc, guide) {
    var unit = "metric";
    var tableUnit = "metric";
    var fit = "relaxed";
    var screen = "find";
    var fields = { height: "", inches: "", weight: "" };
    var root = doc.createElement("div");
    root.className = "appai-fms";
    var panel = doc.createElement("div");
    panel.className = "appai-fms__panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-labelledby", "appai-fms-title");
    root.appendChild(panel);
    root.addEventListener("click", function (event) {
      if (event.target === root) root.remove();
    });

    function remember() {
      ["height", "inches", "weight"].forEach(function (name) {
        var input = panel.querySelector('[data-field="' + name + '"]');
        if (input) fields[name] = input.value;
      });
    }

    function positive(name) {
      var value = Number(fields[name]);
      return value > 0 ? value : null;
    }

    function draw() {
      var shape = guide.shape || "tee";
      var columns = ((guide.measurements && guide.measurements.columns) || []).filter(function (column) {
        var sleeve = column.key === "sleeveLength" || /sleeve/i.test(column.label || "");
        if (sleeve) return shape !== "tee";
        return column.role === "chest" || column.role === "length";
      });
      var rows = (guide.measurements && guide.measurements.rows) || [];
      var html = "<style>" + styles + "</style>";
      html += '<button type="button" class="appai-fms__x" data-close aria-label="Close"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 3 L13 13 M13 3 L3 13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>';
      html += '<h2 id="appai-fms-title">' + (screen === "find" ? "Find my size" : "Garment measurements") + "</h2>";
      html += '<div class="appai-fms__row">' + choice("data-screen", "find", "Suggest my size", screen === "find") + choice("data-screen", "compare", "Compare measurements", screen === "compare") + "</div>";
      if (screen === "find") {
        if (guide.guarantee && guide.guarantee.title) {
          var title = escapeHtml(guide.guarantee.title);
          var detail = escapeHtml(guide.guarantee.detail || "");
          var href = escapeHtml(guide.guarantee.url || "");
          html += "<p>" + (href ? '<a href="' + href + '" target="_blank" rel="noopener">' + title + "</a>" : title) + (detail ? "<br>" + detail : "") + "</p>";
        }
        html += '<div class="appai-fms__row">' + choice("data-unit", "imperial", "ft / lb", unit === "imperial") + choice("data-unit", "metric", "cm / kg", unit === "metric") + "</div>";
        if (unit === "metric") {
          html += '<label>Height (cm)<input data-field="height" inputmode="decimal" placeholder="175"></label>';
        } else {
          html += '<label>Height (ft / in)<span class="appai-fms__row"><input data-field="height" inputmode="decimal" placeholder="5"><input data-field="inches" inputmode="decimal" placeholder="9"></span></label>';
        }
        html += '<label>Weight (' + (unit === "metric" ? "kg" : "lb") + ')<input data-field="weight" inputmode="decimal" placeholder="' + (unit === "metric" ? "75" : "165") + '"></label>';
        html += '<div class="appai-fms__row">' + choice("data-fit", "closer", "Closer", fit === "closer") + choice("data-fit", "relaxed", "Relaxed", fit === "relaxed") + choice("data-fit", "oversized", "Oversized", fit === "oversized") + "</div>";
        html += '<button type="button" class="appai-fms__primary" data-find>Find my size</button>';
        html += "<p>How we suggest a size: we estimate the chest you need from your height and weight, and the body length you need from your height. You get the larger of those two sizes.</p>";
        html += '<div data-result></div>';
      } else {
        html += "<p><strong>" + escapeHtml(guide.measurements.model || "") + " · " + escapeHtml(guide.garmentWord || "Garment") + "</strong></p>";
        html += "<p>These are garment measurements, not body measurements.</p>";
        html += garmentSvg(shape);
        html += '<p class="appai-fms__caption">A — Chest width · B — Body length</p>';
        html += '<div class="appai-fms__row">' + choice("data-table", "imperial", "Inches", tableUnit === "imperial") + choice("data-table", "metric", "Centimetres", tableUnit === "metric") + "</div>";
        html += "<table><tr><th>Size</th>";
        columns.forEach(function (column) { html += "<th>" + escapeHtml(column.label) + "</th>"; });
        html += "</tr>";
        rows.forEach(function (row) {
          html += "<tr><td>" + escapeHtml(row.size) + "</td>";
          columns.forEach(function (column) {
            var inches = Number(row.values[column.key]);
            var shown = !(inches > 0) ? "—" : (tableUnit === "metric" ? (inches * 2.54).toFixed(1) : String(inches));
            html += "<td>" + shown + "</td>";
          });
          html += "</tr>";
        });
        html += "</table>";
        html += "<p><strong>How to measure</strong><br>Chest: straight across, armpit to armpit, with the garment laid flat.<br>Length: from the highest shoulder point beside the collar to the bottom hem.</p>";
        if (guide.measurements.toleranceNote) html += "<p>" + escapeHtml(guide.measurements.toleranceNote) + "</p>";
        html += '<button type="button" class="appai-fms__back" data-back>Back to Find my size</button>';
      }
      panel.innerHTML = html;
      ["height", "inches", "weight"].forEach(function (name) {
        var input = panel.querySelector('[data-field="' + name + '"]');
        if (!input) return;
        input.value = fields[name];
        input.addEventListener("input", function () { fields[name] = input.value; });
      });
      var closer = panel.querySelector("[data-close]");
      if (closer) closer.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        root.remove();
      });
      panel.querySelectorAll("[data-screen]").forEach(function (button) {
        button.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          remember();
          screen = button.getAttribute("data-screen");
          draw();
        });
      });
      var back = panel.querySelector("[data-back]");
      if (back) back.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        screen = "find";
        draw();
      });
      panel.querySelectorAll("[data-unit]").forEach(function (button) {
        button.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          remember();
          unit = button.getAttribute("data-unit");
          draw();
        });
      });
      panel.querySelectorAll("[data-table]").forEach(function (button) {
        button.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          tableUnit = button.getAttribute("data-table");
          draw();
        });
      });
      panel.querySelectorAll("[data-fit]").forEach(function (button) {
        button.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          remember();
          fit = button.getAttribute("data-fit");
          draw();
        });
      });
      var find = panel.querySelector("[data-find]");
      if (find) find.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        remember();
        var slot = panel.querySelector("[data-result]");
        var missing = [];
        var heightCm = null;
        var weightKg = null;
        if (unit === "metric") {
          heightCm = positive("height");
          weightKg = positive("weight");
          if (heightCm == null) missing.push("height");
          if (weightKg == null) missing.push("weight");
        } else {
          var feet = positive("height") || 0;
          var inches = positive("inches") || 0;
          weightKg = positive("weight");
          if (!(feet + inches > 0)) missing.push("height");
          if (weightKg == null) missing.push("weight");
          else weightKg = weightKg * 0.45359237;
          heightCm = feet * 30.48 + inches * 2.54;
        }
        function show(text, size) {
          if (!slot) return;
          if (!size) {
            slot.innerHTML = '<p class="appai-fms__message">' + escapeHtml(text) + "</p>";
            return;
          }
          var safe = escapeHtml(size);
          slot.innerHTML = '<div class="appai-fms__message"><p>Estimated starting size</p><p><strong>' + safe + '</strong></p><p>This is a starting point. Body shape can change the fit.</p><button type="button" class="appai-fms__use" data-use="' + safe + '">Use size ' + safe + "</button></div>";
          var use = slot.querySelector("[data-use]");
          if (use) use.addEventListener("click", function (click) {
            click.preventDefault();
            click.stopPropagation();
            chooseSize(doc, size);
            root.remove();
          });
        }
        if (missing.length) {
          show("Enter your " + missing.join(" and ") + ".");
          return;
        }
        var size = suggest(guide, heightCm, weightKg, fit);
        if (!size) {
          show("No size matches those measurements.");
          return;
        }
        show("", size);
      });
    }

    doc.body.appendChild(root);
    draw();
    return root;
  }

  function hideThemeSizeGuide(doc) {
    if (!doc.getElementById("appai-hide-theme-size-guide")) {
      var style = doc.createElement("style");
      style.id = "appai-hide-theme-size-guide";
      style.textContent = ".bmp-size-guide__trigger{display:none !important;}";
      (doc.head || doc.documentElement).appendChild(style);
    }
    var nodes = doc.querySelectorAll("a, button");
    var index;
    for (index = 0; index < nodes.length; index += 1) {
      var node = nodes[index];
      if (node.closest && (node.closest(".appai-fms") || node.closest(".bmp-size-guide__dialog"))) continue;
      var label = String(node.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (label !== "size guide" && label !== "size chart") continue;
      node.style.setProperty("display", "none", "important");
    }
  }

  function hideEmptyGuide(doc) {
    var nodes = doc.querySelectorAll("a, button");
    var index;
    for (index = 0; index < nodes.length; index += 1) {
      if (nodes[index].closest && nodes[index].closest(".appai-fms")) continue;
      var label = String(nodes[index].textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (label !== "size guide") continue;
      var href = nodes[index].getAttribute && nodes[index].getAttribute("href");
      if (!href || href.charAt(0) === "#") nodes[index].hidden = true;
    }
  }

  // Horizon swaps the variant picker HTML on size and colour changes.
  // The launcher lives in that HTML, so a one-time append is removed with it.
  function placeLauncher(doc, guide, listing) {
    var field = sizeField(doc);
    if (!field) return false;
    if (field.querySelector(".appai-fms__launcher")) return true;
    hideEmptyGuide(doc);
    if (listing) hideThemeSizeGuide(doc);
    var button = doc.createElement("button");
    button.type = "button";
    button.className = "appai-fms__launcher";
    button.textContent = "Find my size";
    button.style.cssText = "background:none;border:0;padding:0;margin:8px 0 0;text-decoration:underline;cursor:pointer;font:inherit;color:inherit;";
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      openDialog(doc, guide);
    });
    field.appendChild(button);
    return true;
  }

  function watchLauncher(doc, guide, listing) {
    placeLauncher(doc, guide, listing);
    if (doc.__appaiFmsWatch) return;
    doc.__appaiFmsWatch = true;
    var queued = false;
    function schedule() {
      if (queued) return;
      queued = true;
      setTimeout(function () {
        queued = false;
        placeLauncher(doc, guide, listing);
      }, 0);
    }
    var rootNode = doc.documentElement || doc.body;
    if (rootNode) new MutationObserver(schedule).observe(rootNode, { childList: true, subtree: true });
    doc.addEventListener("variant:change", schedule);
    doc.addEventListener("variant:changed", schedule);
    doc.addEventListener("shopify:section:load", schedule);
  }

  var api = {
    suggest: suggest,
    openDialog: openDialog,
    chooseSize: chooseSize,
    garmentSvg: garmentSvg,
    hideThemeSizeGuide: hideThemeSizeGuide,
    placeLauncher: placeLauncher,
    watchLauncher: watchLauncher
  };
  root.AppaiFindMySize = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  if (!root.document || root.__appaiFindMySizeMounted) return;
  var host = root.document.querySelector("[data-appai-find-my-size]");
  if (!host) return;
  root.__appaiFindMySizeMounted = true;
  var productId = host.getAttribute("data-product-id") || "";
  var shop = host.getAttribute("data-shop") || "";
  if (!productId) return;

  fetch("/apps/appai/api/storefront/find-my-size?productId=" + encodeURIComponent(productId) + "&shop=" + encodeURIComponent(shop), { credentials: "same-origin" })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (body) {
      var guide = body && body.guide;
      var rows = guide && guide.measurements && guide.measurements.rows;
      if (!rows || !rows.length) {
        hideEmptyGuide(root.document);
        return;
      }
      watchLauncher(root.document, guide, host.getAttribute("data-appai-listing") === "1");
    })
    .catch(function () { hideEmptyGuide(root.document); });
})(typeof window !== "undefined" ? window : globalThis);
