import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FlaskConical, Loader2, Package, Save } from "lucide-react";
import AdminLayout from "@/components/admin-layout";
import EmbedDesign, { type TesterDesignStatus } from "@/pages/embed-design";
import { dedupeProductTypesForPicker } from "@shared/productTypePicker";
import type { ProductType } from "@shared/schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface DesignStudioIdentity {
  shop: string;
  customerId: string;
  savedCount: number;
  savedLimit: number;
  canSaveDesigns?: boolean;
}

/** How long the Send button will wait for an in-flight print-panel upload before ordering anyway. */
const PANEL_SAVE_WAIT_MS = 90_000;

function clearPreviewStudioProductParams() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("productTypeId");
    url.searchParams.delete("loadDesignId");
    url.searchParams.delete("loadMockup");
    url.searchParams.delete("loadProductName");
    url.searchParams.delete("from");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* ignore */
  }
}

export default function AdminCreateProduct() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const initialProductTypeId = searchParams.get("productTypeId");
  const openedFromCatalog =
    searchParams.get("from") === "catalog" ||
    /\/admin\/platform\/catalog/.test(
      typeof document !== "undefined" ? document.referrer : "",
    );

  const [selectedProductTypeId, setSelectedProductTypeId] = useState<number | null>(
    initialProductTypeId ? parseInt(initialProductTypeId) : null
  );

  // Live status of the design on screen, reported by the embedded customizer:
  // which generation job it is + whether its AOP print panels are still uploading.
  // Ref (not state) — updates arrive mid-edit and shouldn't rerender the page.
  const testerStatusRef = useRef<TesterDesignStatus>({
    jobId: null,
    aopPanels: "none",
    flatClipSides: [],
  });
  const saveDesignRef = useRef<(() => Promise<void>) | null>(null);
  /** Flushes pending flat placement / zoom before a test order. */
  const flushDesignRef = useRef<(() => Promise<void>) | null>(null);
  const openEditorRef = useRef<(() => void) | null>(null);
  const [testerHasDesign, setTesterHasDesign] = useState(false);
  const [testerPanelStatus, setTesterPanelStatus] = useState<TesterDesignStatus["aopPanels"]>("none");
  const [placementEditorOpen, setPlacementEditorOpen] = useState(false);
  const [clipConfirmOpen, setClipConfirmOpen] = useState(false);
  const handleTesterDesignStatus = useCallback((status: TesterDesignStatus) => {
    testerStatusRef.current = status;
    setTesterHasDesign(!!status.jobId);
    setTesterPanelStatus(status.aopPanels);
    setPlacementEditorOpen(!!status.placementEditorOpen);
  }, []);

  const leaveProduct = useCallback(() => {
    testerStatusRef.current = {
      jobId: null,
      aopPanels: "none",
      flatClipSides: [],
    };
    setTesterHasDesign(false);
    setTesterPanelStatus("none");
    setPlacementEditorOpen(false);
    setClipConfirmOpen(false);
    try {
      const toRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith("aiart:design:")) toRemove.push(k);
      }
      for (const k of toRemove) sessionStorage.removeItem(k);
    } catch {
      /* sessionStorage may be unavailable */
    }
    clearPreviewStudioProductParams();
    setSelectedProductTypeId(null);
    if (openedFromCatalog) {
      setLocation("/admin/platform/catalog");
    }
  }, [openedFromCatalog, setLocation]);

  const embeddedContext = useMemo(
    () =>
      selectedProductTypeId != null
        ? {
            mode: "admin-tester" as const,
            productTypeId: selectedProductTypeId,
            onTesterDesignStatus: handleTesterDesignStatus,
            saveDesignRef,
            flushDesignRef,
            openEditorRef,
            onLeaveProduct: leaveProduct,
          }
        : undefined,
    [selectedProductTypeId, handleTesterDesignStatus, leaveProduct],
  );

  const {
    data: productTypesRaw,
    isLoading: productTypesLoading,
    isError: productTypesError,
    error: productTypesErrorObj,
    refetch: refetchProductTypes,
  } = useQuery<ProductType[]>({
    queryKey: ["/api/admin/product-types"],
  });
  const productTypes = useMemo(
    () =>
      dedupeProductTypesForPicker(
        Array.isArray(productTypesRaw) ? productTypesRaw : [],
      ),
    [productTypesRaw],
  );

  const { data: studioIdentity } = useQuery<DesignStudioIdentity>({
    queryKey: ["/api/appai/design-studio/identity"],
  });
  const { data: planData } = useQuery<{
    planName: string | null;
    planStatus: string | null;
    isActive: boolean;
  }>({
    queryKey: ["/api/appai/plan"],
  });

  const canSaveDesigns =
    studioIdentity?.canSaveDesigns === true ||
    (!!planData?.isActive &&
      !!planData.planName &&
      ["starter", "dabbler", "pro", "pro_plus"].includes(planData.planName));

  // Send a DRAFT test order to Printify — targets the design currently on screen
  // (falls back to the latest saved design when nothing was generated this session).
  // Waits for an in-flight print-panel upload so the order matches what's on screen.
  // Never sent to production, never charges.
  const testOrderMutation = useMutation({
    mutationFn: async (id: number) => {
      // Persist any pending zoom/placement before ordering.
      if (flushDesignRef.current) {
        await flushDesignRef.current();
      }
      const waitStart = Date.now();
      while (
        testerStatusRef.current.aopPanels === "saving" &&
        Date.now() - waitStart < PANEL_SAVE_WAIT_MS
      ) {
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (testerStatusRef.current.aopPanels === "saving") {
        throw new Error(
          "Placement is still syncing — wait a moment, then send the test order again.",
        );
      }
      // AOP panels and flat Apply both report aopPanels saved/error. Do not send
      // a test order until the on-screen design has been persisted for Printify.
      if (testerStatusRef.current.aopPanels === "error") {
        throw new Error(
          "Last print-file sync failed — nudge the artwork once, wait until the button says Send a Test Order, then try again.",
        );
      }
      if (testerStatusRef.current.aopPanels !== "saved") {
        throw new Error(
          "Print files are still syncing — wait until the button says Send a Test Order, then send again.",
        );
      }
      const jobId = testerStatusRef.current.jobId;
      const response = await apiRequest(
        "POST",
        `/api/admin/product-types/${id}/test-printify-order`,
        jobId ? { designId: jobId } : undefined,
      );
      return response.json();
    },
    onSuccess: (data) => {
      const url = data?.printifyOrderUrl as string | undefined;
      toast({
        title: "Draft test order created in Printify",
        description: data?.printifyOrderId
          ? `Order ${data.printifyOrderId} (DRAFT — not sent to production). Open it in Printify to verify the print file. Delete it there once you're done if automatic fulfillment is enabled on your Printify account.`
          : "Draft order created. Open Printify to verify the print file.",
        action: url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="underline text-xs">
            Open
          </a>
        ) : undefined,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Test order failed", description: error.message, variant: "destructive" });
    },
  });

  const requestTestOrder = useCallback(() => {
    if (selectedProductTypeId == null) return;
    const sides = testerStatusRef.current.flatClipSides ?? [];
    if (sides.length > 0) {
      setClipConfirmOpen(true);
      return;
    }
    testOrderMutation.mutate(selectedProductTypeId);
  }, [selectedProductTypeId, testOrderMutation]);

  const requestPlaceOrTestOrder = useCallback(() => {
    const needsOpen =
      testerPanelStatus === "none" && testerHasDesign && !placementEditorOpen;
    if (needsOpen || testerPanelStatus === "error") {
      openEditorRef.current?.();
      return;
    }
    requestTestOrder();
  }, [testerPanelStatus, testerHasDesign, placementEditorOpen, requestTestOrder]);

  const saveDesignMutation = useMutation({
    mutationFn: async () => {
      const waitStart = Date.now();
      while (
        testerStatusRef.current.aopPanels === "saving" &&
        Date.now() - waitStart < PANEL_SAVE_WAIT_MS
      ) {
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (!saveDesignRef.current) {
        throw new Error("Customizer not ready — wait for it to load.");
      }
      await saveDesignRef.current();
    },
    onSuccess: () => {
      toast({
        title: "Design saved",
        description: "Saved to My Designs. You can list it as a product or reopen it from there.",
        action: (
          <a href="/my-designs" className="underline text-xs">
            Open My Designs
          </a>
        ),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/storefront/customizer/my-designs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/appai/design-studio/identity"] });
    },
    onError: (error: Error) => {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    },
  });

  const syncingPrintFiles = testerPanelStatus === "saving";
  const testerBusy =
    testOrderMutation.isPending || saveDesignMutation.isPending || syncingPrintFiles;
  const needsPlacement =
    testerPanelStatus === "none" && testerHasDesign && !placementEditorOpen;
  const testOrderLabel = testOrderMutation.isPending
    ? "Sending test order…"
    : syncingPrintFiles
      ? "Syncing placement…"
      : needsPlacement
        ? "Open placement editor"
        : testerPanelStatus === "error"
          ? "Retry placement"
          : testerHasDesign
            ? "Send a Test Order to Printify"
            : "Generate artwork first";
  const testerActions = selectedProductTypeId ? (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {canSaveDesigns ? (
          <Button
            variant="outline"
            onClick={() => saveDesignMutation.mutate()}
            disabled={!testerHasDesign || saveDesignMutation.isPending || testOrderMutation.isPending}
            data-testid="button-save-design"
          >
            {saveDesignMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {saveDesignMutation.isPending ? "Saving…" : "Save to My Designs"}
          </Button>
        ) : null}
        {!canSaveDesigns && studioIdentity ? (
          <p className="text-xs text-muted-foreground w-full sm:w-auto">
            Saving to My Designs requires{" "}
            <a href="/admin/plan" className="underline">
              Starter or above
            </a>
            .
          </p>
        ) : null}
        <Button
          onClick={requestPlaceOrTestOrder}
          disabled={
            testOrderMutation.isPending ||
            syncingPrintFiles ||
            (testerPanelStatus === "none" && !testerHasDesign)
          }
          data-testid="button-send-test-order"
        >
          {testerBusy ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <FlaskConical className="h-4 w-4 mr-2" />
          )}
          {testOrderLabel}
        </Button>
      </div>
      {syncingPrintFiles ? (
        <p className="text-xs text-muted-foreground" data-testid="text-design-saving">
          Syncing placement for the test order — usually a few seconds.
        </p>
      ) : null}
      {needsPlacement ? (
        <p className="text-xs text-muted-foreground" data-testid="text-open-placement-editor">
          Same editor as the live store — place the artwork, then Send a Test Order unlocks.
        </p>
      ) : null}
      {testerPanelStatus === "error" ? (
        <p className="text-xs text-destructive" data-testid="text-design-save-error">
          Print file sync failed. Move or scale the artwork once to retry.
        </p>
      ) : null}
      {testerPanelStatus === "saved" && testerHasDesign ? (
        <p className="text-xs text-muted-foreground" data-testid="text-design-saved">
          Ready to send a draft test order. Placement updates sync automatically.
        </p>
      ) : null}
    </div>
  ) : null;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
            <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold" data-testid="text-create-product-title">Preview Studio</h1>
            {selectedProductTypeId != null ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={leaveProduct}
                data-testid="button-preview-studio-back-to-products"
              >
                Back to products
              </Button>
            ) : null}
            </div>
            <p className="text-muted-foreground max-w-2xl">
              Try the AI art studio on your imported products before creating a Live Customizer Page.
              Generate artwork{canSaveDesigns ? ", optionally save to My Designs," : ""} and send a draft
              Printify test order when you&apos;re ready. This does not put a page on your storefront — use
              Customizer Pages → Create Page for that (supplier + suggested pricing required).
              Delete test orders in Printify if automatic fulfilment is enabled.
            </p>
            <p className="text-sm text-muted-foreground max-w-2xl mt-2">
              <span className="font-medium text-foreground">NB:</span> Art Styles can be changed and even
              custom-created for each product. Check the{" "}
              <Link href="/admin/styles" className="underline font-medium text-foreground">
                Art Styles
              </Link>{" "}
              tab.
            </p>
        </div>

        {/* Product Type selector — the "tester" input that chooses which product's customizer to render */}
        <div className="max-w-md space-y-2">
          <Label>Product Type</Label>
          {productTypesLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : productTypesError ? (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <p className="text-sm text-destructive">
                Couldn’t load product types
                {productTypesErrorObj instanceof Error && productTypesErrorObj.message
                  ? `: ${productTypesErrorObj.message}`
                  : "."}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => refetchProductTypes()}
                data-testid="button-retry-product-types"
              >
                Retry
              </Button>
            </div>
          ) : productTypes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No products ready yet. Open Products to Preview or Create Page first.
            </p>
          ) : (
            <Select
              value={selectedProductTypeId != null ? String(selectedProductTypeId) : undefined}
              onValueChange={(v) => {
                // Switching products remounts the customizer — never carry artwork
                // across products (wrong aspect ratio / wrong bake credentials).
                testerStatusRef.current = {
                  jobId: null,
                  aopPanels: "none",
                  flatClipSides: [],
                };
                setTesterHasDesign(false);
                setTesterPanelStatus("none");
                setClipConfirmOpen(false);
                try {
                  const toRemove: string[] = [];
                  for (let i = 0; i < sessionStorage.length; i++) {
                    const k = sessionStorage.key(i);
                    if (k && k.startsWith("aiart:design:")) toRemove.push(k);
                  }
                  for (const k of toRemove) sessionStorage.removeItem(k);
                } catch {
                  /* sessionStorage may be unavailable */
                }
                // Strip loadDesignId / loadMockup — otherwise EmbedDesign remounts
                // onto the new product and immediately re-applies the previous
                // saved design (wrong product, wrong test-order target).
                try {
                  const url = new URL(window.location.href);
                  url.searchParams.delete("loadDesignId");
                  url.searchParams.delete("loadMockup");
                  url.searchParams.delete("loadProductName");
                  url.searchParams.set("productTypeId", v);
                  window.history.replaceState({}, "", url.toString());
                } catch {
                  /* ignore */
                }
                setSelectedProductTypeId(parseInt(v));
              }}
            >
              <SelectTrigger data-testid="select-product-type">
                <SelectValue placeholder="Select a product type" />
              </SelectTrigger>
              <SelectContent>
                {productTypes.map((pt) => (
                  <SelectItem key={pt.id} value={pt.id.toString()}>
                    {pt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className="text-xs text-muted-foreground">
            This renders the exact same designer your customers use — it always stays in sync with the live customizer.
            Switching products clears the current artwork so aspect ratios stay correct.
          </p>
        </div>

        {/* Live customizer — the IDENTICAL storefront design studio, rendered IN-PROCESS via the
            admin-tester runtime mode. In-process (not an iframe) so it isn't blocked by the app's
            frame-ancestors CSP and so it reuses the App Bridge session token for /api/generate. */}
        {selectedProductTypeId ? (
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <EmbedDesign
                key={selectedProductTypeId}
                embeddedContext={embeddedContext}
                testerActions={testerActions}
              />
            </CardContent>
          </Card>
        ) : (
          <div className="aspect-[16/9] max-h-[480px] bg-muted rounded-lg flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-2" />
              <p className="text-sm">Select a product type to load its customizer</p>
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={clipConfirmOpen} onOpenChange={setClipConfirmOpen}>
        <AlertDialogContent data-testid="dialog-tester-flat-clip-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Artwork extends past the print area</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const sides = testerStatusRef.current.flatClipSides ?? [];
                const label =
                  sides.length === 2
                    ? "front and back"
                    : sides[0] === "back"
                      ? "the back"
                      : "the front";
                return (
                  <>
                    Your design on {label} is larger than the printable area and will be
                    trimmed on the product. Continue only if you are happy with that
                    cropping before sending the Printify test order.
                  </>
                );
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-tester-flat-clip-cancel">
              Go back and adjust
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-tester-flat-clip-continue"
              onClick={() => {
                setClipConfirmOpen(false);
                if (selectedProductTypeId != null) {
                  testOrderMutation.mutate(selectedProductTypeId);
                }
              }}
            >
              Continue with clipped artwork
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
