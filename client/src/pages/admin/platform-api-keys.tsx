import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AdminLayout from "@/components/admin-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { apiRequest, parseApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

type StoredCredential = {
  id: number;
  provider: string;
  credentialRef: string;
  lastFour: string;
  status: "active" | "invalid" | "unchecked";
  lastValidatedAt: string | null;
  lastValidationError: string | null;
  createdBy: string | null;
  updatedAt: string;
};

type RefRow = {
  id: string;
  provider: "openai" | "google" | "replicate";
  scope: "shared" | "dedicated";
  label: string;
  envVar: string;
  envPresent: boolean;
  stored: StoredCredential | null;
  lastResolved: { source: "db" | "env"; at: string } | null;
};

type CredentialsResponse = { encryptionConfigured: boolean; storeError: string | null; refs: RefRow[] };

const PROVIDER_LABEL: Record<RefRow["provider"], string> = { openai: "OpenAI", google: "Google", replicate: "Replicate" };

function statusBadge(status: StoredCredential["status"]) {
  if (status === "active") return <Badge className="bg-green-600 hover:bg-green-600">active</Badge>;
  if (status === "invalid") return <Badge variant="destructive">invalid</Badge>;
  return <Badge variant="secondary">unchecked</Badge>;
}

function when(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleString() : "never";
}

/** Which source readCredential() will use right now for this ref. */
function effectiveSource(r: RefRow): string {
  if (r.stored?.status === "active") return "Admin key (overrides env)";
  if (r.envPresent) return `Env var ${r.envVar}`;
  return "None — generations on this ref fail";
}

function CredentialRow({ row, disabled }: { row: RefRow; disabled: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/platform/credentials"] });
  const onError = (title: string) => (e: Error) =>
    toast({ title, description: parseApiErrorMessage(e.message), variant: "destructive" });

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/platform/credentials", { credentialRef: row.id, key });
      return (await res.json()) as { credential: StoredCredential };
    },
    onSuccess: ({ credential }) => {
      setKey("");
      setEditing(false);
      refresh();
      toast({
        title: `Saved ••••${credential.lastFour} — ${credential.status}`,
        description: credential.lastValidationError ?? undefined,
        variant: credential.status === "invalid" ? "destructive" : undefined,
      });
    },
    onError: onError("Save failed"),
    onSettled: () => setKey(""),
  });

  const validate = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/platform/credentials/${id}/validate`)).json(),
    onSuccess: () => refresh(),
    onError: onError("Validate failed"),
  });

  const disable = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/platform/credentials/${id}/disable`)).json(),
    onSuccess: () => refresh(),
    onError: onError("Disable failed"),
  });

  const s = row.stored;
  return (
    <div className="border rounded-md p-4 space-y-3" data-testid={`credential-row-${row.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium">
            {PROVIDER_LABEL[row.provider]} · {row.label}
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            {row.id} · {row.scope} · env {row.envVar} {row.envPresent ? "set" : "not set"}
          </div>
        </div>
        <div className="text-xs text-right">
          <div>
            In use: <span className="font-medium" data-testid={`credential-source-${row.id}`}>{effectiveSource(row)}</span>
          </div>
          {row.lastResolved && (
            <div className="text-muted-foreground" data-testid={`credential-last-resolved-${row.id}`}>
              Last generation resolved via {row.lastResolved.source === "db" ? "admin key" : "env var"} at{" "}
              {when(row.lastResolved.at)}
            </div>
          )}
        </div>
      </div>

      {s ? (
        <div className="flex flex-wrap items-center gap-3 text-sm" data-testid={`credential-stored-${row.id}`}>
          <span className="font-mono">••••{s.lastFour}</span>
          {statusBadge(s.status)}
          <span className="text-xs text-muted-foreground">validated {when(s.lastValidatedAt)}</span>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">No admin key stored.</div>
      )}
      {s?.lastValidationError && (
        <Alert variant={s.status === "invalid" ? "destructive" : "default"} className="py-2">
          <AlertDescription className="text-xs break-words" data-testid={`credential-error-${row.id}`}>
            {s.lastValidationError}
          </AlertDescription>
        </Alert>
      )}

      {editing ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) save.mutate();
          }}
        >
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={`Paste ${PROVIDER_LABEL[row.provider]} API key`}
            className="max-w-md font-mono"
            data-testid={`credential-input-${row.id}`}
          />
          <Button type="submit" disabled={!key.trim() || save.isPending} data-testid={`credential-save-${row.id}`}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Save &amp; validate
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setKey("");
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => setEditing(true)}
            data-testid={`credential-replace-${row.id}`}
          >
            {s ? "Replace" : "Add key"}
          </Button>
          {s && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || validate.isPending}
                onClick={() => validate.mutate(s.id)}
                data-testid={`credential-validate-${row.id}`}
              >
                {validate.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Validate
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled || disable.isPending}
                onClick={() => disable.mutate(s.id)}
                data-testid={`credential-disable-${row.id}`}
              >
                Disable (use env var)
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ApiKeysPanel() {
  const { data: platformStatus, isLoading: statusLoading } = useQuery<{ isPlatformAdmin: boolean }>({
    queryKey: ["/api/platform/admin/status"],
  });
  const { data, isLoading } = useQuery<CredentialsResponse>({
    queryKey: ["/api/platform/credentials"],
    enabled: !!platformStatus?.isPlatformAdmin,
  });

  if (statusLoading || (platformStatus?.isPlatformAdmin && isLoading)) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!platformStatus?.isPlatformAdmin) {
    return (
      <Alert variant="destructive" data-testid="api-keys-forbidden">
        <AlertTitle>Platform operator only</AlertTitle>
        <AlertDescription>Provider API keys are not available for merchant admins.</AlertDescription>
      </Alert>
    );
  }

  const storeDisabled = !data?.encryptionConfigured || !!data?.storeError;
  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12" data-testid="api-keys-root">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Provider API keys</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Keys entered here are encrypted at rest and override the matching Railway env var for that credential —
          no redeploy needed. Keys are write-only: only the last four characters are ever shown. Disable a key to fall
          back to the env var.
        </p>
      </div>
      {!data?.encryptionConfigured && (
        <Alert variant="destructive" data-testid="api-keys-encryption-missing">
          <AlertTitle>Key store disabled</AlertTitle>
          <AlertDescription>
            CREDENTIAL_ENCRYPTION_KEY is not configured on this server, so only env-var keys are used.
          </AlertDescription>
        </Alert>
      )}
      {data?.storeError && (
        <Alert variant="destructive">
          <AlertTitle>Key store unavailable</AlertTitle>
          <AlertDescription>{data.storeError}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Credentials</CardTitle>
          <CardDescription>
            One row per credential the generation resolver knows. Which store or pack uses which credential is set in
            server code, not here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data?.refs.map((row) => <CredentialRow key={row.id} row={row} disabled={storeDisabled} />)}
        </CardContent>
      </Card>
    </div>
  );
}

export default function PlatformApiKeysPage() {
  return (
    <AdminLayout>
      <ApiKeysPanel />
    </AdminLayout>
  );
}
