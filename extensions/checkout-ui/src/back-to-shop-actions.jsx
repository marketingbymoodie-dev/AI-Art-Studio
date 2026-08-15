/**
 * Same Back-to-shop banner in the checkout form column (above contact).
 * Header target can miss if the shop’s checkout profile has not picked up
 * a newly added static target; this slot is already used by most shops.
 */
import { reactExtension } from "@shopify/ui-extensions-react/checkout";
import { BackToCreatorShop } from "./back-to-shop-shared.jsx";

export default reactExtension("purchase.checkout.actions.render-before", () => (
  <BackToCreatorShop />
));
