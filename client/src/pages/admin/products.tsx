import AdminLayout from "@/components/admin-layout";
import CatalogActivateSection from "@/components/admin/CatalogActivateSection";

export default function AdminProducts() {
  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-products-title">
            Products
          </h1>
          <p className="text-muted-foreground">
            Preview in-app, or Create Page to pick a Printify supplier and suggested retail. Provider,
            pricing, variants, and Art Styles are set on the Customizer Page.
          </p>
        </div>

        <CatalogActivateSection
          mode="catalogue"
          title="Ready-to-go products"
          description="Every product below is published for your shop. Preview opens the studio in-app. Create Page goes live on your storefront."
        />
      </div>
    </AdminLayout>
  );
}
