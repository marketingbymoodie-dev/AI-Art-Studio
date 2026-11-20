import { useMemo, useState } from "react";
import {
  FIT_ORDER,
  inchesToCentimetres,
  suggestSize,
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
  const sleeve = shape === "tee" ? 28 : 8;
  const bodyTop = shape === "sweatshirt" ? 46 : 36;
  return (
    <svg viewBox="0 0 160 150" className="mx-auto h-36 w-40" aria-hidden="true">
      {shape === "sweatshirt" ? <path d="M68 28c6-10 18-10 24 0v14H68z" fill="none" stroke="currentColor" strokeWidth="1.5" /> : null}
      <path
        d={`M${sleeve} ${bodyTop} L58 30 L70 42 L90 42 L102 30 L${160 - sleeve} ${bodyTop} L${160 - sleeve} ${bodyTop + 18} L108 ${bodyTop + 8} L108 128 L52 128 L52 ${bodyTop + 8} L${sleeve} ${bodyTop + 18} Z`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <line x1="58" y1="78" x2="102" y2="78" stroke="currentColor" strokeWidth="1" />
      <text x="80" y="74" textAnchor="middle" fontSize="11">A</text>
      <line x1="112" y1="34" x2="112" y2="128" stroke="currentColor" strokeWidth="1" />
      <text x="122" y="84" fontSize="11">B</text>
    </svg>
  );
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
  const rows = guide?.measurements.rows || [];
  const columns = useMemo(
    () => (guide?.measurements.columns || []).filter((column) => column.role !== "other" || column.key === "sleeveLength"),
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
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 text-neutral-900 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 id="find-my-size-title" className="text-lg font-semibold">
                {screen === "find" ? "Find my size" : "Garment measurements"}
              </h2>
              <button type="button" className="text-sm underline" onClick={() => setOpen(false)}>Close</button>
            </div>
            {screen === "find" ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className="rounded-md border border-neutral-900 px-3 py-2 text-sm" onClick={() => setScreen("find")}>Suggest my size</button>
                  <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => setScreen("compare")}>Compare measurements</button>
                </div>
                {guide.guarantee ? (
                  <p className="text-sm">
                    {guide.guarantee.url ? <a className="underline" href={guide.guarantee.url}>{guide.guarantee.title}</a> : <span className="underline">{guide.guarantee.title}</span>}
                    <span className="mt-1 block text-neutral-600">{guide.guarantee.detail}</span>
                  </p>
                ) : null}
                <div className="inline-flex rounded-md border p-1 text-sm">
                  <button type="button" className={unit === "imperial" ? "rounded bg-neutral-900 px-3 py-1 text-white" : "px-3 py-1"} onClick={() => setUnit("imperial")}>ft / lb</button>
                  <button type="button" className={unit === "metric" ? "rounded bg-neutral-900 px-3 py-1 text-white" : "px-3 py-1"} onClick={() => setUnit("metric")}>cm / kg</button>
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
                    <button key={id} type="button" className={fit === id ? "rounded-md bg-neutral-900 px-3 py-1 text-sm text-white" : "rounded-md border px-3 py-1 text-sm"} onClick={() => setFit(id)}>
                      {FIT_LABEL[id]}
                    </button>
                  ))}
                </div>
                <button type="button" className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm text-white" onClick={find}>Find my size</button>
                <p className="text-xs text-neutral-600">How we suggest a size: we estimate chest size from your height and weight, add the ease for the fit you picked, and choose the smallest size whose chest is at least that big.</p>
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
                <p className="text-sm font-medium">{guide.measurements.model} · {guide.garmentWord}</p>
                <p className="text-sm text-neutral-600">These are garment measurements, not body measurements.</p>
                <GarmentDrawing shape={guide.shape} />
                <p className="text-center text-xs text-neutral-600">A = chest width · B = body length</p>
                <div className="inline-flex rounded-md border p-1 text-sm">
                  <button type="button" className={tableUnit === "imperial" ? "rounded bg-neutral-900 px-3 py-1 text-white" : "px-3 py-1"} onClick={() => setTableUnit("imperial")}>Inches</button>
                  <button type="button" className={tableUnit === "metric" ? "rounded bg-neutral-900 px-3 py-1 text-white" : "px-3 py-1"} onClick={() => setTableUnit("metric")}>Centimetres</button>
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
                <button type="button" className="text-sm underline" onClick={() => setScreen("find")}>Back to Find my size</button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
