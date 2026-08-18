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
          className={`relative inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors ${
            danger
              ? "border-red-300 bg-red-50 text-red-800 hover:bg-red-100"
              : active
                ? "border-gray-400 bg-gray-100 text-gray-900"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          }`}
        >
          <Icon className="h-4 w-4" />
          {badge != null && String(badge) !== "" && (
            <span className="absolute -right-1.5 -top-1.5 min-w-[1.1rem] rounded-full bg-gray-900 px-1 text-[10px] font-medium leading-4 text-white">
              {badge}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
