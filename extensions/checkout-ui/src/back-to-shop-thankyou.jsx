import { reactExtension } from "@shopify/ui-extensions-react/checkout";
import { BackToCreatorShop } from "./back-to-shop-shared.jsx";

export default reactExtension("purchase.thank-you.header.render-after", () => (
  <BackToCreatorShop />
));
