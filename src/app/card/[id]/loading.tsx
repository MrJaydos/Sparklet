export default function Loading() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg px-5 pb-8 pt-[calc(env(safe-area-inset-top)+2rem)]">
      <div className="h-4 w-24 animate-pulse rounded bg-neutral-800" />
      <div className="mt-6 h-40 w-full animate-pulse rounded-2xl bg-neutral-900" />
      <div className="mt-5 h-4 w-28 animate-pulse rounded-full bg-neutral-800" />
      <div className="mt-4 h-7 w-3/4 animate-pulse rounded bg-neutral-800" />
      <div className="mt-4 space-y-2">
        <div className="h-4 w-full animate-pulse rounded bg-neutral-900" />
        <div className="h-4 w-full animate-pulse rounded bg-neutral-900" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-neutral-900" />
      </div>
    </main>
  );
}
