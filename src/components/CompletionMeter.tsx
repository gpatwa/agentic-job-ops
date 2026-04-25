import type { ProfileCompletion } from "../models/domain";

interface CompletionMeterProps {
  completion: ProfileCompletion;
}

export function CompletionMeter({ completion }: CompletionMeterProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium text-slate-700">Profile completion</span>
        <span className="text-sm font-semibold text-emerald-700">
          {completion.percent}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-emerald-600 transition-all"
          style={{ width: `${completion.percent}%` }}
        />
      </div>
      {completion.missingFields.length > 0 && (
        <p className="text-sm text-slate-500">
          Missing: {completion.missingFields.slice(0, 4).join(", ")}
          {completion.missingFields.length > 4 ? "..." : ""}
        </p>
      )}
    </div>
  );
}
