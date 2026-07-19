export default function Loading() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-6 py-10">
      <div className="h-7 w-56 animate-pulse rounded bg-neutral-800" />
      <div className="mt-2 h-4 w-72 animate-pulse rounded bg-neutral-900" />
      <div className="mt-6 grid grid-cols-2 gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-neutral-900" />
        ))}
      </div>
      <div className="mt-6 h-12 w-full animate-pulse rounded-xl bg-neutral-900" />
    </main>
  );
}
