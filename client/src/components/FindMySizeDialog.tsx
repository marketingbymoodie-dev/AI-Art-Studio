import { useMemo, useState } from "react";
import {
  FIT_ORDER,
  inchesToCentimetres,
  suggestSize,
  visibleMeasurementColumns,
  type FindMySizeGuide,
  type FitId,
} from "@shared/findMySize";

type Unit = "metric" | "imperial";

const FIT_LABEL: Record<FitId, string> = {
  closer: "Closer",
  relaxed: "Relaxed",
  oversized: "Oversized",
};

function GarmentDrawing({ shape }: { shape: FindMySizeGuide["shape"] }) {
  const tee = shape === "tee";
  const shoulder = 48;
  const hem = 162;
  const arrowY = 88;
  const arrowX = tee ? 208 : 230;
  const body = tee
    ? "M24 60 L72 48 L98 48 Q110 60 122 48 L148 48 L196 60 L186 86 L148 74 L148 162 L72 162 L72 74 L34 86 Z"
    : "M4 64 L72 48 L98 48 Q110 60 122 48 L148 48 L216 64 L206 90 L148 74 L148 162 L72 162 L72 74 L14 90 Z";
  return (
    <svg viewBox="0 0 260 190" className="mx-auto h-[174px] w-[238px]" aria-hidden="true">
      <path d={body} fill="#f7f7f7" stroke="#171717" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {shape === "sweatshirt" ? <path d="M88 48 C88 14 132 14 132 48" fill="none" stroke="#171717" strokeWidth="1.5" strokeLinecap="round" /> : null}
      {shape === "sweatshirt" ? <path d="M72 150 H148 M16 66 L24 88 M204 66 L196 88" fill="none" stroke="#171717" strokeWidth="1.5" strokeLinecap="round" /> : null}
      <line x1="84" y1={arrowY} x2="136" y2={arrowY} stroke="#171717" strokeWidth="1.25" />
      <path d={`M84 ${arrowY} l6 -3.5 M84 ${arrowY} l6 3.5 M136 ${arrowY} l-6 -3.5 M136 ${arrowY} l-6 3.5`} fill="none" stroke="#171717" strokeWidth="1.25" strokeLinecap="round" />
      <text x="110" y={arrowY - 6} textAnchor="middle" fontSize="12" fill="#171717">A</text>
      <line x1={arrowX} y1={shoulder} x2={arrowX} y2={hem} stroke="#171717" strokeWidth="1.25" />
      <path d={`M${arrowX} ${shoulder} l-3.5 6 M${arrowX} ${shoulder} l3.5 6 M${arrowX} ${hem} l-3.5 -6 M${arrowX} ${hem} l3.5 -6`} fill="none" stroke="#171717" strokeWidth="1.25" strokeLinecap="round" />
      <text x={arrowX + 8} y="108" fontSize="12" fill="#171717">B</text>
    </svg>
  );
}

function choiceClass(pressed: boolean): string {
  return pressed
    ? "rounded-md bg-neutral-900 px-3 py-2 text-sm text-white"
    : "rounded-md border border-neutral-900 bg-white px-3 py-2 text-sm text-neutral-900";
}

export function FindMySizeButton({
  guide,
  onUseSize,
}: {
  guide: FindMySizeGuide | null | undefined;
  onUseSize: (sizeName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<"find" | "compare">("find");
  const [unit, setUnit] = useState<Unit>("metric");
  const [tableUnit, setTableUnit] = useState<Unit>("metric");
  const [height, setHeight] = useState("");
  const [heightInches, setHeightInches] = useState("");
  const [weight, setWeight] = useState("");
  const [fit, setFit] = useState<FitId>("relaxed");
  const [result, setResult] = useState<string>("");
  const [notice, setNotice] = useState("");
  const rows = guide?.measurements.rows || [];
  const columns = useMemo(
    () => visibleMeasurementColumns(guide?.shape || "tee", guide?.measurements.columns || []),
    [guide],
  );
  const chest = guide?.measurements.columns.find((column) => column.role === "chest");
  if (!guide || !chest || !rows.some((row) => Number(row.values[chest.key]) > 0)) return null;

  const heightCm = () => {
    if (unit === "metric") {
      const value = Number(height);
      return value > 0 ? value : null;
    }
    const feet = Number(height);
    const inches = Number(heightInches);
    const total = (feet > 0 ? feet * 30.48 : 0) + (inches > 0 ? inches * 2.54 : 0);
    return total > 0 ? total : null;
  };
  const weightKg = () => {
    const value = Number(weight);
    if (!(value > 0)) return null;
    return unit === "metric" ? value : value * 0.45359237;
  };

  const find = () => {
    const heightValue = heightCm();
    const weightValue = weightKg();
    if (heightValue == null || weightValue == null) {
      setResult("");
      setNotice("Enter your height and weight.");
      return;
    }
    const suggested = suggestSize({
      heightCm: heightValue,
      weightKg: weightValue,
      fit,
      ease: guide.ease,
      columns: guide.measurements.columns,
      rows: guide.measurements.rows,
    });
    setNotice(suggested?.size ? "" : "No size matches those measurements.");
    setResult(suggested?.size || "");
  };

  const display = (inches: number) => tableUnit === "metric" ? inchesToCentimetres(inches).toFixed(1) : inches.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");

  return (
    <>
      <button type="button" className="text-sm underline" onClick={() => { setOpen(true); setScreen("find"); }}>
        Find my size
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" role="presentation" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-labelledby="find-my-size-title"
            className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 text-neutral-900 shadow-xl"
            style={{ fontFamily: "var(--font-body--family, var(--font-body-family, inherit))" }}
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center text-neutral-900" aria-label="Close" onClick={() => setOpen(false)}>
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <path d="M3 3 L13 13 M13 3 L3 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <h2 id="find-my-size-title" className="mb-4 pr-8 text-lg font-semibold" style={{ fontFamily: "inherit", letterSpacing: "normal", textTransform: "none" }}>
              {screen === "find" ? "Find my size" : "Garment measurements"}
            </h2>
            {screen === "find" ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className={choiceClass(true)} aria-pressed="true" onClick={() => setScreen("find")}>Suggest my size</button>
                  <button type="button" className={choiceClass(false)} aria-pressed="false" onClick={() => setScreen("compare")}>Compare measurements</button>
                </div>
                {guide.guarantee ? (
                  <p className="text-sm">
                    {guide.guarantee.url ? <a className="underline" href={guide.guarantee.url} target="_blank" rel="noopener">{guide.guarantee.title}</a> : <span className="underline">{guide.guarantee.title}</span>}
                    <span className="mt-1 block text-neutral-600">{guide.guarantee.detail}</span>
                  </p>
                ) : null}
                <div className="inline-flex rounded-md border p-1 text-sm">
                  <button type="button" className={choiceClass(unit === "imperial")} aria-pressed={unit === "imperial"} onClick={() => setUnit("imperial")}>ft / lb</button>
                  <button type="button" className={choiceClass(unit === "metric")} aria-pressed={unit === "metric"} onClick={() => setUnit("metric")}>cm / kg</button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {unit === "metric" ? (
                    <label className="text-sm">Height (cm)
                      <input className="mt-1 w-full rounded border px-2 py-1" inputMode="decimal" value={height} onChange={(event) => setHeight(event.target.value)} placeholder="175" />
                    </label>
                  ) : (
                    <label className="text-sm">Height (ft / in)
                      <span className="mt-1 flex gap-2">
                        <input className="w-full rounded border px-2 py-1" inputMode="decimal" value={height} onChange={(event) => setHeight(event.target.value)} placeholder="5" />
                        <input className="w-full rounded border px-2 py-1" inputMode="decimal" value={heightInches} onChange={(event) => setHeightInches(event.target.value)} placeholder="9" />
                      </span>
                    </label>
                  )}
                  <label className="text-sm">Weight ({unit === "metric" ? "kg" : "lb"})
                    <input className="mt-1 w-full rounded border px-2 py-1" inputMode="decimal" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder={unit === "metric" ? "75" : "165"} />
                  </label>
                </div>
                <div className="flex gap-2">
                  {FIT_ORDER.map((id) => (
                    <button key={id} type="button" className={choiceClass(fit === id)} aria-pressed={fit === id} onClick={() => setFit(id)}>
                      {FIT_LABEL[id]}
                    </button>
                  ))}
                </div>
                <button type="button" className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm text-white" onClick={find}>Find my size</button>
                <p className="text-xs text-neutral-600">How we suggest a size: we estimate the chest you need from your height and weight, and the body length you need from your height. You get the larger of those two sizes.</p>
                {notice ? <p className="rounded-md border border-neutral-900 p-3 text-sm">{notice}</p> : null}
                {result ? (
                  <div className="rounded-md border p-3">
                    <p className="text-xs uppercase tracking-wide text-neutral-500">Estimated starting size</p>
                    <p className="text-2xl font-semibold">{result}</p>
                    <p className="mt-1 text-sm text-neutral-600">This is a starting point. Body shape can change the fit.</p>
                    <button
                      type="button"
                      className="mt-3 rounded-md bg-neutral-900 px-3 py-2 text-sm text-white"
                      onClick={() => { onUseSize(result); setOpen(false); }}
                    >
                      Use size {result}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className={choiceClass(false)} aria-pressed="false" onClick={() => setScreen("find")}>Suggest my size</button>
                  <button type="button" className={choiceClass(true)} aria-pressed="true" onClick={() => setScreen("compare")}>Compare measurements</button>
                </div>
                <p className="text-sm font-medium">{guide.measurements.model} · {guide.garmentWord}</p>
                <p className="text-sm text-neutral-600">These are garment measurements, not body measurements.</p>
                <GarmentDrawing shape={guide.shape} />
                <p className="text-center text-xs text-neutral-600">A — Chest width · B — Body length</p>
                <div className="inline-flex gap-2 text-sm">
                  <button type="button" className={choiceClass(tableUnit === "imperial")} aria-pressed={tableUnit === "imperial"} onClick={() => setTableUnit("imperial")}>Inches</button>
                  <button type="button" className={choiceClass(tableUnit === "metric")} aria-pressed={tableUnit === "metric"} onClick={() => setTableUnit("metric")}>Centimetres</button>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="py-1 text-left">Size</th>
                      {columns.map((column) => <th key={column.key} className="py-1 text-right">{column.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.size} className="border-t">
                        <td className="py-1">{row.size}</td>
                        {columns.map((column) => (
                          <td key={column.key} className="py-1 text-right">{row.values[column.key] == null ? "—" : display(row.values[column.key])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-sm">
                  <p className="font-medium">How to measure</p>
                  <p>Chest: straight across, armpit to armpit, with the garment laid flat.</p>
                  <p>Length: from the highest shoulder point beside the collar to the bottom hem.</p>
                </div>
                {guide.measurements.toleranceNote ? <p className="text-xs text-neutral-600">{guide.measurements.toleranceNote}</p> : null}
                <button type="button" className={choiceClass(false)} onClick={() => setScreen("find")}>Back to Find my size</button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
