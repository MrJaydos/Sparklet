// Native share sheet where available (the "Apple/Google share card"), else
// clipboard. Used by both the menu's invite button and the in-feed prompt.
export async function shareOrCopy(
  data: { title: string; text: string; url: string },
  onCopied?: () => void
) {
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share(data);
      return;
    } catch {
      return; // user cancelled the share sheet — don't also fall through to copy
    }
  }
  try {
    await navigator.clipboard.writeText(data.url);
    onCopied?.();
  } catch {
    /* clipboard unavailable */
  }
}
