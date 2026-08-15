import { useEffect, useState } from "react";
import { readLastCreatorVisit, type LastCreatorVisit } from "@shared/lastCreatorVisit";

export function LastCreatorReturnButton({
  className = "",
  variant = "default",
}: {
  className?: string;
  variant?: "default" | "luxe";
}) {
  const [visit, setVisit] = useState<LastCreatorVisit | null>(null);

  useEffect(() => {
    setVisit(readLastCreatorVisit());
  }, []);

  if (!visit) return null;

  const label = `Back to ${visit.shopName}`;
  if (variant === "luxe") {
    return (
      <a href={visit.returnUrl} className={`luxe-btn-ghost ${className}`.trim()}>
        {label}
      </a>
    );
  }

  return (
    <a
      href={visit.returnUrl}
      className={`inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 ${className}`.trim()}
    >
      {label}
    </a>
  );
}
