import { Skeleton } from "@/components/ui/skeleton";

/** Shown at once while a page's data loads, so navigation never feels stuck. */
export default function AppLoading() {
  return (
    <div className="p-4 sm:p-0" role="status" aria-label="Loading">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="mt-5 h-72" />
    </div>
  );
}
