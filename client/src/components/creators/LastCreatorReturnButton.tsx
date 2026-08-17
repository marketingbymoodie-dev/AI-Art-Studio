import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  isHandleLikeShopName,
  readLastCreatorVisit,
  writeLastCreatorVisit,
  type LastCreatorVisit,
} from "@shared/lastCreatorVisit";
import { currentCreatorReturnUrl } from "@/lib/creatorCart";

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

  const live = useQuery({
    queryKey: ["/api/creators/storefront", visit?.username],
    enabled: !!visit?.username,
    queryFn: async () => {
      const res = await fetch(`/api/creators/storefront/${encodeURIComponent(visit!.username)}`);
      if (!res.ok) return null;
      const json = await res.json();
      return json.creator as {
        username: string;
        publicName: string;
        storefrontUrlPath?: string;
      };
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    const creator = live.data;
    if (!creator?.username) return;
    const next = writeLastCreatorVisit({
      username: creator.username,
      shopName: creator.publicName || creator.username,
      returnUrl: currentCreatorReturnUrl(creator.username),
    });
    if (
      next &&
      (next.username !== visit?.username || next.shopName !== visit?.shopName)
    ) {
      setVisit(next);
    }
  }, [live.data]);

  if (!visit) return null;

  const liveName = live.data?.publicName?.trim() || "";
  const storedName = visit.shopName?.trim() || "";
  const shopName =
    liveName ||
    (!isHandleLikeShopName(storedName, visit.username) ? storedName : "");
  const href = live.data?.username
    ? currentCreatorReturnUrl(live.data.username)
    : visit.returnUrl;
  const label = shopName ? `Back to ${shopName}` : "Back to shop";

  if (variant === "luxe") {
    return (
      <a href={href} className={`luxe-btn-ghost luxe-btn-return ${className}`.trim()}>
        {label}
      </a>
    );
  }

  return (
    <a
      href={href}
      className={`inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 ${className}`.trim()}
    >
      {label}
    </a>
  );
}
