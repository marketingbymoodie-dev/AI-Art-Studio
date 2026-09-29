import { Pencil } from "lucide-react";

/**
 * Three selectable concept rows — the Quotes "write 3 quotes" picker, shared
 * with style-pack concept writers. Markup, classes and (for Quotes) test ids
 * are exactly the original Quotes rows; `secondary` adds a muted second line
 * (e.g. a pack concept's short visual idea) and is omitted for Quotes.
 */
export type ConceptOptionRow = { primary: string; secondary?: string | null };

export type ConceptOptionsPickerProps = {
  rows: ConceptOptionRow[];
  pick: number | null;
  onPick: (i: number) => void;
  /** Test-id stem: "quote" → button-quote-option-0 … (Quotes' original ids). */
  idStem: string;
  boxTestId: string;
  /** Inline editing of the primary line (Quotes). Omit for read-only rows. */
  edit?: {
    editingIndex: number | null;
    onChange: (i: number, value: string) => void;
    onCommit: (i: number) => void;
    onBegin: (i: number) => void;
    onRevert: (i: number) => void;
    ariaLabel: (i: number) => string;
  };
  newLink: { label: string; onClick: () => void; testId: string };
  moreLink: { label: string; onClick: () => void; disabled?: boolean; testId: string };
};

export function ConceptOptionsPicker({ rows, pick, onPick, idStem, boxTestId, edit, newLink, moreLink }: ConceptOptionsPickerProps) {
  return (
    <div className="rounded-md border bg-background" data-testid={boxTestId}>
      {rows.map((row, i) => {
        const selected = pick === i;
        const editing = edit?.editingIndex === i;
        return (
          <div
            key={i}
            className={`flex items-start gap-2 border-b last:border-b-0 px-2 py-2 ${selected ? "bg-muted" : ""}`}
          >
            <button
              type="button"
              className={`mt-0.5 h-6 w-6 shrink-0 rounded-full text-xs font-semibold ${
                selected ? "bg-foreground text-background" : "border border-border text-muted-foreground"
              }`}
              onClick={() => onPick(i)}
              data-testid={`button-${idStem}-option-${i}`}
            >
              {i + 1}
            </button>
            {editing && edit ? (
              <textarea
                className="min-h-[40px] w-full resize-none bg-transparent text-sm outline-none"
                value={row.primary}
                autoFocus
                onChange={(e) => edit.onChange(i, e.target.value)}
                onBlur={() => edit.onCommit(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    (e.currentTarget as HTMLTextAreaElement).blur();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    edit.onRevert(i);
                  }
                }}
                data-testid={`input-${idStem}-option-${i}`}
              />
            ) : row.secondary ? (
              <div className="min-h-[40px] w-full" data-testid={`text-${idStem}-option-${i}`}>
                <p className="text-sm font-semibold leading-snug">{row.primary || "No words"}</p>
                <p className="text-xs leading-snug text-muted-foreground">{row.secondary}</p>
              </div>
            ) : (
              <p className="min-h-[40px] w-full text-sm leading-snug" data-testid={`text-${idStem}-option-${i}`}>
                {row.primary}
              </p>
            )}
            {edit ? (
              <button
                type="button"
                className="mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={edit.ariaLabel(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => (editing ? edit.onCommit(i) : edit.onBegin(i))}
                data-testid={`button-${idStem}-edit-${i}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        );
      })}
      <div className="flex items-center justify-between px-2 py-1.5">
        <button
          type="button"
          className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
          onClick={newLink.onClick}
          data-testid={newLink.testId}
        >
          {newLink.label}
        </button>
        <button
          type="button"
          className="text-[11px] text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
          disabled={moreLink.disabled}
          onClick={moreLink.onClick}
          data-testid={moreLink.testId}
        >
          {moreLink.label}
        </button>
      </div>
    </div>
  );
}
