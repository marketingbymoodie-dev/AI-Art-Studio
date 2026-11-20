/**
 * Find my size on the product page, next to the size selector.
 * The chest estimate matches shared/findMySize.ts.
 */
(function () {
  if (window.__appaiFindMySize) return;
  window.__appaiFindMySize = true;

  var host = document.querySelector("[data-appai-find-my-size]");
  if (!host) return;
  var productId = host.getAttribute("data-product-id") || "";
  var shop = host.getAttribute("data-shop") || "";
  if (!productId) return;

  function chestInches(heightCm, weightKg) {
    var heightMm = heightCm * 10;
    var weight = weightKg * 10;
    var male = 928.002 - 0.242 * heightMm + 0.622 * weight;
    var female = 916.48 - 0.282 * heightMm + 0.727 * weight;
    return (male + female) / 2 / 25.4;
  }

  function suggest(guide, heightCm, weightKg, fit) {
    var body = chestInches(heightCm, weightKg);
    var chest = (guide.measurements.columns || []).filter(function (column) { return column.role === "chest"; })[0];
    if (!chest || !(body > 0)) return "";
    var target = body + Number(guide.ease[fit]);
    var rows = guide.measurements.rows || [];
    var index;
    for (index = 0; index < rows.length; index += 1) {
      var width = Number(rows[index].values[chest.key]);
      if (width > 0 && width * 2 + 1e-9 >= target) return rows[index].size;
    }
    for (index = rows.length - 1; index >= 0; index -= 1) {
      if (Number(rows[index].values[chest.key]) > 0) return rows[index].size;
    }
    return "";
  }

  function sizeField() {
    var fields = document.querySelectorAll("fieldset, [data-option-name]");
    var index;
    for (index = 0; index < fields.length; index += 1) {
      var text = String(fields[index].textContent || "").toLowerCase();
      if (text.indexOf("size") !== -1 && text.indexOf("color") === -1 && text.indexOf("colour") === -1) return fields[index];
    }
    return null;
  }

  function hideEmptyGuide() {
    var nodes = document.querySelectorAll("a, button");
    var index;
    for (index = 0; index < nodes.length; index += 1) {
      var label = String(nodes[index].textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (label !== "size guide") continue;
      var href = nodes[index].getAttribute && nodes[index].getAttribute("href");
      if (!href || href.charAt(0) === "#") nodes[index].style.display = "none";
    }
  }

  function chooseSize(name) {
    var wanted = name.toLowerCase();
    var field = sizeField() || document;
    var radios = field.querySelectorAll('input[type="radio"]');
    var index;
    for (index = 0; index < radios.length; index += 1) {
      var radio = radios[index];
      var value = String(radio.value || "").trim().toLowerCase();
      var label = radio.closest("label");
      var text = label ? String(label.textContent || "").trim().toLowerCase() : "";
      if (value === wanted || text === wanted) {
        radio.click();
        return;
      }
    }
    var buttons = field.querySelectorAll("button, label");
    for (index = 0; index < buttons.length; index += 1) {
      if (String(buttons[index].textContent || "").replace(/\s+/g, " ").trim().toLowerCase() === wanted) {
        buttons[index].click();
        return;
      }
    }
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function openDialog(guide) {
    var unit = "metric";
    var tableUnit = "metric";
    var fit = "relaxed";
    var screen = "find";
    var root = document.createElement("div");
    root.style.cssText = "position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.4);display:flex;align-items:flex-end;justify-content:center;padding:12px;";
    var panel = document.createElement("div");
    panel.setAttribute("role", "dialog");
    panel.style.cssText = "background:#fff;color:#171717;max-width:32rem;width:100%;max-height:90vh;overflow:auto;border-radius:8px;padding:20px;font:inherit;";
    root.appendChild(panel);
    root.addEventListener("click", function (event) { if (event.target === root) root.remove(); });

    function numberValue(id) {
      var input = panel.querySelector("#" + id);
      var value = Number(input && input.value);
      return value > 0 ? value : null;
    }

    function draw() {
      var chest = (guide.measurements.columns || []).filter(function (column) { return column.role === "chest" || column.role === "length" || column.key === "sleeveLength"; });
      var rows = guide.measurements.rows || [];
      var html = '<div style="display:flex;justify-content:space-between;gap:12px;"><h2 style="margin:0;font-size:1.1rem;">' + (screen === "find" ? "Find my size" : "Garment measurements") + '</h2><button type="button" data-close style="background:none;border:0;text-decoration:underline;cursor:pointer;">Close</button></div>';
      if (screen === "find") {
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px;"><button type="button" data-screen="find" style="border:1px solid #171717;border-radius:6px;padding:8px;">Suggest my size</button><button type="button" data-screen="compare" style="border:1px solid #d4d4d4;border-radius:6px;padding:8px;">Compare measurements</button></div>';
        if (guide.guarantee) {
          var title = escapeHtml(guide.guarantee.title);
          var detail = escapeHtml(guide.guarantee.detail);
          var href = escapeHtml(guide.guarantee.url);
          html += '<p style="font-size:.9rem;">' + (href ? '<a href="' + href + '">' + title + "</a>" : title) + '<br><span style="color:#525252;">' + detail + "</span></p>";
        }
        html += '<div style="margin:12px 0;"><button type="button" data-unit="imperial">ft / lb</button> <button type="button" data-unit="metric">cm / kg</button></div>';
        html += unit === "metric"
          ? '<label>Height (cm)<input id="appai-height" style="display:block;width:100%;margin-top:4px;" inputmode="decimal" placeholder="175"></label>'
          : '<label>Height (ft / in)<span style="display:flex;gap:8px;"><input id="appai-height" style="width:100%;" inputmode="decimal" placeholder="5"><input id="appai-inches" style="width:100%;" inputmode="decimal" placeholder="9"></span></label>';
        html += '<label>Weight (' + (unit === "metric" ? "kg" : "lb") + ')<input id="appai-weight" style="display:block;width:100%;margin-top:4px;" inputmode="decimal"></label>';
        html += '<div style="margin:12px 0;"><button type="button" data-fit="closer">Closer</button> <button type="button" data-fit="relaxed">Relaxed</button> <button type="button" data-fit="oversized">Oversized</button></div>';
        html += '<button type="button" data-find style="width:100%;background:#171717;color:#fff;border:0;border-radius:6px;padding:10px;">Find my size</button>';
        html += '<p style="font-size:.75rem;color:#525252;">How we suggest a size: we estimate chest size from your height and weight, add the ease for the fit you picked, and choose the smallest size whose chest is at least that big.</p>';
        html += '<div data-result></div>';
      } else {
        html += '<p style="font-weight:600;">' + escapeHtml(guide.measurements.model) + " · " + escapeHtml(guide.garmentWord) + "</p>";
        html += '<p>These are garment measurements, not body measurements.</p>';
        var outline = guide.shape === "tee"
          ? "M28 36 L58 30 L70 42 L90 42 L102 30 L132 36 L132 54 L108 44 L108 128 L52 128 L52 44 L28 54 Z"
          : "M8 36 L58 30 L70 42 L90 42 L102 30 L152 36 L152 54 L108 44 L108 128 L52 128 L52 44 L8 54 Z";
        var hood = guide.shape === "sweatshirt" ? '<path d="M68 18c6-8 18-8 24 0v14H68z" fill="none" stroke="currentColor" stroke-width="1.5"></path>' : "";
        html += '<svg viewBox="0 0 160 150" width="150" height="130" aria-hidden="true" style="display:block;margin:0 auto;">' + hood + '<path d="' + outline + '" fill="none" stroke="currentColor" stroke-width="1.5"></path><text x="80" y="78" text-anchor="middle" font-size="12">A</text><text x="118" y="90" font-size="12">B</text></svg>';
        html += '<p style="text-align:center;">A = chest width · B = body length</p>';
        html += '<div><button type="button" data-table="imperial">Inches</button> <button type="button" data-table="metric">Centimetres</button></div>';
        html += "<table style=\"width:100%;margin-top:8px;border-collapse:collapse;\"><tr><th style=\"text-align:left;\">Size</th>";
        chest.forEach(function (column) { html += "<th style=\"text-align:right;\">" + escapeHtml(column.label) + "</th>"; });
        html += "</tr>";
        rows.forEach(function (row) {
          html += "<tr><td>" + escapeHtml(row.size) + "</td>";
          chest.forEach(function (column) {
            var inches = Number(row.values[column.key]);
            var shown = !(inches > 0) ? "—" : (tableUnit === "metric" ? (inches * 2.54).toFixed(1) : String(inches));
            html += '<td style="text-align:right;">' + shown + "</td>";
          });
          html += "</tr>";
        });
        html += "</table>";
        html += "<p><strong>How to measure</strong><br>Chest: straight across, armpit to armpit, with the garment laid flat.<br>Length: from the highest shoulder point beside the collar to the bottom hem.</p>";
        if (guide.measurements.toleranceNote) html += "<p>" + escapeHtml(guide.measurements.toleranceNote) + "</p>";
        html += '<button type="button" data-screen="find" style="background:none;border:0;text-decoration:underline;cursor:pointer;">Back to Find my size</button>';
      }
      panel.innerHTML = html;
      var closer = panel.querySelector("[data-close]");
      if (closer) closer.addEventListener("click", function () { root.remove(); });
      panel.querySelectorAll("[data-screen]").forEach(function (button) {
        button.addEventListener("click", function () { screen = button.getAttribute("data-screen"); draw(); });
      });
      panel.querySelectorAll("[data-unit]").forEach(function (button) {
        button.addEventListener("click", function () { unit = button.getAttribute("data-unit"); draw(); });
      });
      panel.querySelectorAll("[data-table]").forEach(function (button) {
        button.addEventListener("click", function () { tableUnit = button.getAttribute("data-table"); draw(); });
      });
      panel.querySelectorAll("[data-fit]").forEach(function (button) {
        button.addEventListener("click", function () { fit = button.getAttribute("data-fit"); });
      });
      var find = panel.querySelector("[data-find]");
      if (find) find.addEventListener("click", function () {
        var height = numberValue("appai-height");
        var extra = numberValue("appai-inches");
        var weight = numberValue("appai-weight");
        if (weight == null || (height == null && extra == null)) return;
        var heightCm = unit === "metric" ? height : ((height || 0) * 30.48) + ((extra || 0) * 2.54);
        var weightKg = unit === "metric" ? weight : weight * 0.45359237;
        var size = suggest(guide, heightCm, weightKg, fit);
        var slot = panel.querySelector("[data-result]");
        if (!slot || !size) return;
        var safeSize = escapeHtml(size);
        slot.innerHTML = '<p style="letter-spacing:.04em;text-transform:uppercase;font-size:.75rem;">Estimated starting size</p><p style="font-size:1.6rem;font-weight:600;margin:0;">' + safeSize + '</p><p>This is a starting point. Body shape can change the fit.</p><button type="button" data-use="' + safeSize + '">Use size ' + safeSize + "</button>";
        var use = slot.querySelector("[data-use]");
        if (use) use.addEventListener("click", function () { chooseSize(size); root.remove(); });
      });
    }

    document.body.appendChild(root);
    draw();
  }

  fetch("/apps/appai/api/storefront/find-my-size?productId=" + encodeURIComponent(productId) + "&shop=" + encodeURIComponent(shop), { credentials: "same-origin" })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (body) {
      var guide = body && body.guide;
      if (!guide || !guide.measurements || !guide.measurements.rows || !guide.measurements.rows.length) {
        hideEmptyGuide();
        return;
      }
      var field = sizeField();
      if (!field) return;
      hideEmptyGuide();
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = "Find my size";
      button.style.cssText = "background:none;border:0;padding:0;margin:8px 0 0;text-decoration:underline;cursor:pointer;font:inherit;";
      field.appendChild(button);
      button.addEventListener("click", function () { openDialog(guide); });
    })
    .catch(function () { hideEmptyGuide(); });
})();
