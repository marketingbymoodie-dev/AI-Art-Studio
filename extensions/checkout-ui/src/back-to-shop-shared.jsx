import {
  Banner,
  Button,
  useAttributeValues,
  useCartLines,
} from "@shopify/ui-extensions-react/checkout";

function attrVal(entry, key) {
  if (!entry) return "";
  const k = entry.key != null ? entry.key : entry.name;
  if (String(k) !== key) return "";
  const v = entry.value != null ? entry.value : entry.val;
  return v ? String(v) : "";
}

function lineAttr(line, key) {
  const attrs = line && Array.isArray(line.attributes) ? line.attributes : [];
  for (let i = 0; i < attrs.length; i++) {
    const v = attrVal(attrs[i], key);
    if (v) return v;
  }
  const comps = line && Array.isArray(line.lineComponents) ? line.lineComponents : [];
  for (let c = 0; c < comps.length; c++) {
    const ca = comps[c] && Array.isArray(comps[c].attributes) ? comps[c].attributes : [];
    for (let i = 0; i < ca.length; i++) {
      const v = attrVal(ca[i], key);
      if (v) return v;
    }
  }
  return "";
}

function firstHttps(candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const u = String(candidates[i] || "").trim();
    if (u.indexOf("https://") === 0) return u;
  }
  return "";
}

function fallbackFromUsername(username) {
  const handle = String(username || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  if (!handle) return "";
  return `https://ai-art-studio-staging.up.railway.app/c/${handle}`;
}

export function resolveCreatorReturn(cartReturn, cartName, lines) {
  let returnUrl = cartReturn ? String(cartReturn) : "";
  let shopName = cartName ? String(cartName) : "";
  let username = "";
  for (let i = 0; i < (lines || []).length; i++) {
    const line = lines[i];
    if (!returnUrl) {
      returnUrl = firstHttps([
        lineAttr(line, "creator_return_url"),
        lineAttr(line, "_creator_return_url"),
      ]);
    }
    if (!shopName) {
      shopName =
        lineAttr(line, "creator_shop_name") ||
        lineAttr(line, "_creator_shop_name") ||
        lineAttr(line, "_creator_username") ||
        lineAttr(line, "creator_username");
    }
    if (!username) {
      username = lineAttr(line, "_creator_username") || lineAttr(line, "creator_username");
    }
  }
  if (!returnUrl || returnUrl.indexOf("https://") !== 0) {
    returnUrl = fallbackFromUsername(username || shopName);
  }
  return { returnUrl, shopName };
}

export function BackToCreatorShop() {
  const [cartReturnHidden, cartReturnPublic, cartNameHidden, cartNamePublic] =
    useAttributeValues([
      "_creator_return_url",
      "creator_return_url",
      "_creator_shop_name",
      "creator_shop_name",
    ]);
  const lines = useCartLines();
  const { returnUrl, shopName } = resolveCreatorReturn(
    firstHttps([cartReturnPublic, cartReturnHidden]),
    cartNamePublic || cartNameHidden || "",
    lines,
  );

  if (!returnUrl || returnUrl.indexOf("https://") !== 0) return null;

  const label = shopName ? `Back to ${shopName}` : "Back to shop";
  return (
    <Banner status="info" title="Continue shopping">
      <Button to={returnUrl} kind="primary" external>
        {label}
      </Button>
    </Banner>
  );
}
