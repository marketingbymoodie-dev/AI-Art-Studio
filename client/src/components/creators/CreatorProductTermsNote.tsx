type Props = {
  className?: string;
  /** Use on product/cart pages. Designer already has the generate checkbox. */
  compact?: boolean;
};

export function CreatorProductTermsNote({ className, compact }: Props) {
  const termsHref = "/terms#customers";
  const shippingHref = "/terms#shipping-and-delivery";
  const returnsHref = "/terms#custom-products-and-returns";

  return (
    <p
      className={
        className ||
        "text-xs leading-relaxed text-muted-foreground"
      }
    >
      {compact
        ? "Made to order. Not returnable for change of mind or the wrong size. Shipping times vary by print partner."
        : "These are made-to-order prints. They are not returnable for change of mind or because you picked the wrong size or colour. Production and shipping times vary by print partner, partner location, and destination — checkout shows the rate for your address."}{" "}
      <a href={returnsHref} className="underline underline-offset-2 hover:text-foreground">
        Returns
      </a>
      {" · "}
      <a href={shippingHref} className="underline underline-offset-2 hover:text-foreground">
        Shipping
      </a>
      {" · "}
      <a href={termsHref} className="underline underline-offset-2 hover:text-foreground">
        Full terms
      </a>
    </p>
  );
}
