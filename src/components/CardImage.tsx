"use client";

import { useEffect, useState } from "react";

/** Card image that expands to a full-screen lightbox on tap.
 * Hides itself entirely if the image fails to load. */
export function CardImage({ src, className }: { src: string; className?: string }) {
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // GIPHY's terms require attribution on their content.
  const isGiphy = /(^|\.)giphy\.com\//.test(src.replace(/^https?:\/\//, ""));

  if (hidden) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="View image full screen"
        className={`relative block w-full cursor-zoom-in overflow-hidden ${className ?? ""}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setHidden(true)}
        />
        {isGiphy && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-neutral-300">
            via GIPHY
          </span>
        )}
      </button>

      {open && (
        <div
          data-lightbox
          role="dialog"
          aria-modal="true"
          aria-label="Image viewer"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[60] flex touch-none cursor-zoom-out items-center justify-center overscroll-contain bg-black/90 p-4 backdrop-blur-sm"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className="max-h-full max-w-full rounded-xl object-contain" />
        </div>
      )}
    </>
  );
}
