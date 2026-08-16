import AdminLayout from "@/components/admin-layout";
import { SupportInbox } from "@/components/support/SupportInbox";
import { apiFetch } from "@/lib/queryClient";

export default function AdminSupportPage() {
  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Support</h1>
          <p className="text-muted-foreground">
            Send a request and reply in the same thread. We will email you when we answer.
          </p>
        </div>
        <SupportInbox
          listPath="/api/admin/support/tickets"
          createPath="/api/admin/support/tickets"
          detailPath={(id) => `/api/admin/support/tickets/${id}`}
          replyPath={(id) => `/api/admin/support/tickets/${id}/replies`}
          fetcher={apiFetch}
          queryKey={["/api/admin/support/tickets"]}
        />
      </div>
    </AdminLayout>
  );
}
