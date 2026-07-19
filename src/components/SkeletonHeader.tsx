// Placeholder for AppHeader while a page's data is still loading — same
// fixed position/sizing, so nothing shifts once the real header mounts.
export function SkeletonHeader() {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex items-center justify-between gap-2 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.625rem)]">
      <div className="h-5 w-24 animate-pulse rounded bg-neutral-800" />
      <div className="flex items-center gap-1.5">
        <div className="h-7 w-14 animate-pulse rounded-full bg-neutral-900" />
        <div className="h-7 w-14 animate-pulse rounded-full bg-neutral-900" />
        <div className="h-7 w-7 animate-pulse rounded-full bg-neutral-900" />
      </div>
    </div>
  );
}
