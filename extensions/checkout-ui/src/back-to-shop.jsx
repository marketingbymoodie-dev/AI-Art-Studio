/**
 * Creator Marketplace — send shoppers back to the creator storefront.
 *
 * Shopify’s checkout header (“AI Art Studio…”) always links to the platform
 * shop homepage. Extensions cannot hide or overlay that chrome. This block
 * sits directly under the header on desktop and mobile (checkout is not the
 * Online Store theme).
 */
import { reactExtension } from "@shopify/ui-extensions-react/checkout";
import { BackToCreatorShop } from "./back-to-shop-shared.jsx";

export default reactExtension("purchase.checkout.header.render-after", () => (
  <BackToCreatorShop />
));
