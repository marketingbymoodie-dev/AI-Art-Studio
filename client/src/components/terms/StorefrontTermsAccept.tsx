import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { DEFAULT_TERMS_CONTENT, publicTermsHref, type TermsContent } from "@shared/termsContent";
import { getCentralAppOrigin } from "@/lib/storefrontAuth";

const STORAGE_PREFIX = "appai_terms_accept:";

export function termsAcceptStorageKey(content: Pick<TermsContent, "revision" | "lastUpdated">): string {
  return `${STORAGE_PREFIX}${content.revision}:${content.lastUpdated}`;
}

export function useStorefrontTermsAccept(enabled: boolean) {
  const { data } = useQuery<{ content: TermsContent }>({
    queryKey: ["/api/terms"],
    enabled,
    staleTime: 60_000,
  });
  const content = data?.content ?? DEFAULT_TERMS_CONTENT;
  const storageKey = termsAcceptStorageKey(content);
  const [accepted, setAcceptedState] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    try {
      setAcceptedState(window.sessionStorage.getItem(storageKey) === "1");
    } catch {
      setAcceptedState(false);
    }
  }, [enabled, storageKey]);

  const setAccepted = (value: boolean) => {
    setAcceptedState(value);
    try {
      if (value) window.sessionStorage.setItem(storageKey, "1");
      else window.sessionStorage.removeItem(storageKey);
    } catch {
      /* ignore quota / privacy mode */
    }
  };

  return {
    content,
    accepted: enabled ? accepted : true,
    setAccepted,
  };
}

export function StorefrontTermsAccept({
  content,
  accepted,
  onAcceptedChange,
  appOrigin,
}: {
  content: TermsContent;
  accepted: boolean;
  onAcceptedChange: (value: boolean) => void;
  /** Railway / central app origin. Shopify store hosts are ignored. */
  appOrigin?: string;
}) {
  return (
    <label className="mt-2 flex items-start gap-2 text-[11px] leading-snug text-muted-foreground">
      <Checkbox
        checked={accepted}
        onCheckedChange={(c) => onAcceptedChange(!!c)}
        className="mt-0.5"
        data-testid="checkbox-storefront-terms"
      />
      <span>
        {accepted ? "Generation Terms" : content.checkboxes.storefrontAccept}{" "}
        <a
          href={publicTermsHref("customers", appOrigin || getCentralAppOrigin())}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          {content.checkboxes.readFullTermsLabel}
        </a>
      </span>
    </label>
  );
}
