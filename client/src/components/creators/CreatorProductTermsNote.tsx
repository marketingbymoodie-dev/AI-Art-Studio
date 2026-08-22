import { publicTermsHref } from "@shared/termsContent";
import { getCentralAppOrigin } from "@/lib/storefrontAuth";

type Props = {
  className?: string;
  /** Use on product/cart pages. Designer already has the generate checkbox. */
  compact?: boolean;
  /** Railway origin. Shopify iframe hosts are ignored so links do not hit *.myshopify.com/terms. */
  appOrigin?: string;
};

export function CreatorProductTermsNote({ className, compact, appOrigin }: Props) {
  const origin = appOrigin || getCentralAppOrigin();
  const termsHref = publicTermsHref("customers", origin);
  const shippingHref = publicTermsHref("shipping-and-delivery", origin);
  const returnsHref = publicTermsHref("custom-products-and-returns", origin);
  const linkClass = "underline underline-offset-2 hover:text-foreground";

  return (
    <p className={className || "text-xs leading-relaxed text-muted-foreground"}>
      {compact
        ? "Made to order. Not returnable for change of mind or the wrong size. Shipping times vary by print partner."
        : "These are made-to-order prints. They are not returnable for change of mind or because you picked the wrong size or colour. Production and shipping times vary by print partner, partner location, and destination — checkout shows the rate for your address."}{" "}
      <a href={returnsHref} target="_blank" rel="noreferrer" className={linkClass}>
        Returns
      </a>
      {" · "}
      <a href={shippingHref} target="_blank" rel="noreferrer" className={linkClass}>
        Shipping
      </a>
      {" · "}
      <a href={termsHref} target="_blank" rel="noreferrer" className={linkClass}>
        Full terms
      </a>
    </p>
  );
}
