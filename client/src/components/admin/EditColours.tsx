import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

type Colour = { name: string; hex: string; live: boolean };
type Plan = {
  colours: Colour[];
  add: Array<{ name: string; variants: number }>;
  remove: Array<{ name: string; variants: number }>;
  mockupsToMake: string[];
  warnings: string[];
  blockers: string[];
};
type Job = { phase: string; label: string; error: string };

const ACTIVE = new Set(["queued", "mockups", "shopify", "printify", "shipping"]);

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Colour edit stopped");
  return data;
}

/** Tick the product type's colours, preview the change, then save it in the background. */
export function EditColours({ apiBase }: { apiBase: string }) {
  const [colours, setColours] = useState<Colour[]>([]);
  const [ticked, setTicked] = useState<string[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`${apiBase}/colours`, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) {
        setError(data?.error || "Colours could not be loaded");
        return;
      }
      const rows = Array.isArray(data?.colours) ? data.colours as Colour[] : [];
      setColours(rows);
      setTicked(rows.filter((row) => row.live).map((row) => row.name));
    })();
    return () => { cancelled = true; };
  }, [apiBase]);

  useEffect(() => {
    if (!job || !ACTIVE.has(job.phase)) return;
    const timer = window.setInterval(async () => {
      const res = await fetch(`${apiBase}/colours/job`, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      const next = data?.job as Job | null;
      if (!next) return;
      setJob(next);
      if (next.phase === "done") {
        const fresh = await fetch(`${apiBase}/colours`, { credentials: "include" });
        const body = await fresh.json().catch(() => ({}));
        const rows = Array.isArray(body?.colours) ? body.colours as Colour[] : [];
        setColours(rows);
        setTicked(rows.filter((row) => row.live).map((row) => row.name));
        setPlan(null);
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [apiBase, job]);

  const jobActive = ACTIVE.has(job?.phase || "");

  return (
    <div className="space-y-2" data-testid="edit-colours">
      <p className="text-xs text-muted-foreground">Live colours start ticked. Save shows the change before it runs.</p>
      <ul className="space-y-1">
        {colours.map((colour) => {
          const on = ticked.includes(colour.name);
          return (
            <li key={colour.name}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={busy || jobActive}
                  data-testid={`edit-colour-${colour.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  onChange={() => {
                    setPlan(null);
                    setTicked(on ? ticked.filter((name) => name !== colour.name) : [...ticked, colour.name]);
                  }}
                />
                <span className="inline-block h-3 w-3 rounded-full border" style={{ backgroundColor: `#${colour.hex.replace(/^#/, "")}` }} />
                {colour.name}
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || jobActive || !colours.length}
          onClick={async () => {
            setBusy(true);
            setError("");
            setPlan(null);
            try {
              setPlan(await postJson(`${apiBase}/colours/preview`, { colours: ticked }));
            } catch (err) {
              setError(err instanceof Error ? err.message : "Preview failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          Save
        </Button>
      </div>
      {plan ? (
        <div className="space-y-1 text-xs" data-testid="edit-colours-plan">
          {plan.add.map((row) => <p key={`add-${row.name}`}>Add {row.name}: {row.variants} variant{row.variants === 1 ? "" : "s"}</p>)}
          {plan.remove.map((row) => <p key={`remove-${row.name}`}>Remove {row.name}: {row.variants} variant{row.variants === 1 ? "" : "s"}</p>)}
          {plan.mockupsToMake.length ? <p>Mockups to make: {plan.mockupsToMake.join(", ")}</p> : null}
          {!plan.add.length && !plan.remove.length ? <p>No colour change.</p> : null}
          {plan.warnings.map((warning) => <p key={warning}>{warning}</p>)}
          {plan.blockers.map((blocker) => <p key={blocker}>{blocker}</p>)}
          {!plan.blockers.length && (plan.add.length || plan.remove.length) ? (
            <Button
              type="button"
              size="sm"
              disabled={busy || jobActive}
              data-testid="edit-colours-apply"
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const data = await postJson(`${apiBase}/colours`, { colours: ticked });
                  setJob({ phase: data.phase || "queued", label: data.label || "Queued", error: "" });
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Apply failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Apply
            </Button>
          ) : null}
        </div>
      ) : null}
      {jobActive ? <p className="text-xs" data-testid="edit-colours-job">{job?.label}</p> : null}
      {job?.phase === "done" ? <p className="text-xs" data-testid="edit-colours-done">Colours saved</p> : null}
      {job?.phase === "failed" || error ? <p className="whitespace-pre-wrap text-xs" data-testid="edit-colours-error">{error || job?.error}</p> : null}
    </div>
  );
}
