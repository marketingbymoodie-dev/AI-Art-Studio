import type { LucideIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Props = {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  badge?: string | number | null;
  testId?: string;
};

export function StudioMenuIconButton({
  label,
  icon: Icon,
  onClick,
  active,
  danger,
  badge,
  testId,
}: Props) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          data-testid={testId}
          className={`relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border transition-colors min-[400px]:h-[4.5rem] min-[400px]:w-[4.5rem] ${
            danger
              ? "border-red-300 bg-red-50 text-red-800 hover:bg-red-100"
              : active
                ? "border-gray-400 bg-gray-100 text-gray-900"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          }`}
        >
          <Icon className="h-5 w-5 min-[400px]:h-8 min-[400px]:w-8" />
          {badge != null && String(badge) !== "" && (
            <span className="absolute -right-1 -top-1 min-w-[1.1rem] rounded-full bg-gray-900 px-1 text-[10px] font-medium leading-4 text-white min-[400px]:-right-1.5 min-[400px]:-top-1.5 min-[400px]:min-w-[1.25rem] min-[400px]:text-[11px]">
              {badge}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
