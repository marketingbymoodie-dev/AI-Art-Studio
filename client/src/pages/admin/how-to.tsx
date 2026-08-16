import AdminLayout from "@/components/admin-layout";
import { HowToLibrary } from "@/components/support/HowToLibrary";
import { apiFetch } from "@/lib/queryClient";

export default function AdminHowToPage() {
  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">How To</h1>
          <p className="text-muted-foreground">
            Short guides we add as we discover things that need explaining.
          </p>
        </div>
        <HowToLibrary audience="merchant" fetcher={apiFetch} />
      </div>
    </AdminLayout>
  );
}
