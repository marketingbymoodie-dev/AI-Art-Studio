import type { ClassifiedGenerationFailure } from "@shared/generationFailure";
import { GeneratingLoader } from "./ProductMockup";

const STUDIO_HEADLINE = {
  line1: "Generating your artwork",
  line2: "May take up to 60 seconds.",
};

type PreviewStudioGenOverlayProps = {
  pending: boolean;
  failure: ClassifiedGenerationFailure | null;
  onRetry: () => void;
  onEditPrompt: () => void;
};

export function PreviewStudioGenOverlay({
  pending,
  failure,
  onRetry,
  onEditPrompt,
}: PreviewStudioGenOverlayProps) {
  if (!pending && !failure) return null;

  return (
    <div
      className="absolute inset-0 z-40 flex min-h-[280px] flex-col"
      data-testid="preview-studio-gen-overlay"
      data-pending={pending ? "true" : "false"}
      data-failure-kind={failure?.kind ?? ""}
    >
      {pending ? (
        <GeneratingLoader headline={STUDIO_HEADLINE} />
      ) : failure ? (
        <div
          className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 bg-zinc-200 px-6 text-center"
          data-testid="preview-studio-gen-error"
        >
          <p className="max-w-sm text-sm font-semibold text-zinc-800">{failure.userMessage}</p>
          {failure.kind === "retriable" ? (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800"
              data-testid="preview-studio-gen-retry"
            >
              Retry
            </button>
          ) : (
            <button
              type="button"
              onClick={onEditPrompt}
              className="rounded-md border border-zinc-700 bg-white px-4 py-2 text-xs font-semibold text-zinc-900 hover:bg-zinc-50"
              data-testid="preview-studio-gen-edit"
            >
              Edit description
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
