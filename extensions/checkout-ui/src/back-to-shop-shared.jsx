import {
  Banner,
  Button,
  useAttributeValues,
  useCartLines,
} from "@shopify/ui-extensions-react/checkout";

function lineAttr(line, key) {
  const attrs = line && Array.isArray(line.attributes) ? line.attributes : [];
  for (let i = 0; i < attrs.length; i++) {
    const a = attrs[i];
    if (!a) continue;
    if (String(a.key) === key && a.value) return String(a.value);
  }
  return "";
}

export function BackToCreatorShop() {
  const [cartReturn, cartName] = useAttributeValues([
    "_creator_return_url",
    "_creator_shop_name",
  ]);
  const lines = useCartLines();

  let returnUrl = cartReturn ? String(cartReturn) : "";
  let shopName = cartName ? String(cartName) : "";
  for (let i = 0; i < (lines || []).length; i++) {
    const line = lines[i];
    if (!returnUrl) returnUrl = lineAttr(line, "_creator_return_url");
    if (!shopName) {
      shopName = lineAttr(line, "_creator_shop_name") || lineAttr(line, "_creator_username");
    }
  }

  if (!returnUrl || returnUrl.indexOf("https://") !== 0) return null;

  const label = shopName ? `Back to ${shopName}` : "Back to shop";
  return (
    <Banner status="info" title={label}>
      <Button to={returnUrl} kind="secondary">
        {label}
      </Button>
    </Banner>
  );
}
