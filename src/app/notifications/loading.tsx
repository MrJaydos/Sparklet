import { SkeletonHeader } from "@/components/SkeletonHeader";

export default function Loading() {
  return (
    <>
      <SkeletonHeader />
      <main className="mx-auto min-h-dvh w-full max-w-lg px-5 pb-8 pt-[calc(env(safe-area-inset-top)+4rem)]">
        <div className="h-7 w-44 animate-pulse rounded bg-neutral-800" />

        <div className="mt-6 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-neutral-900" />
          ))}
        </div>
      </main>
    </>
  );
}
