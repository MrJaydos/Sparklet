/**
 * Source attribution that cannot lie.
 *
 * The generator emits a free-text `publisher` per source, and it hallucinates
 * it: cards shipped with "NASA", "Rijksmuseum", "Credit Suisse" and
 * "Château de Versailles" as the publisher on links that all pointed at
 * en.wikipedia.org. That label is what the UI renders on the source chip, so
 * readers were shown an attribution to an institution that never published
 * the page — while the homepage promised "real sources you can verify".
 *
 * The URL is the only trustworthy part of a model-produced citation, so the
 * displayed publisher is derived from its host and the model's string is
 * ignored for display. Unknown hosts show the bare domain: less pretty than
 * an invented institution name, but true and checkable at a glance.
 */

/** Hosts common enough in the bank to deserve a proper name. */
const KNOWN_PUBLISHERS: Record<string, string> = {
  "en.wikipedia.org": "Wikipedia",
  "wikipedia.org": "Wikipedia",
  "nasa.gov": "NASA",
  "science.nasa.gov": "NASA",
  "ncbi.nlm.nih.gov": "NCBI",
  "pubmed.ncbi.nlm.nih.gov": "PubMed",
  "nih.gov": "NIH",
  "niddk.nih.gov": "NIH",
  "nidcd.nih.gov": "NIH",
  "nccih.nih.gov": "NIH",
  "nimh.nih.gov": "NIH",
  "cdc.gov": "CDC",
  "who.int": "World Health Organization",
  "heart.org": "American Heart Association",
  "bmj.com": "The BMJ",
  "nature.com": "Nature",
  "science.org": "Science",
  "sciencedirect.com": "ScienceDirect",
  "journals.sagepub.com": "SAGE Journals",
  "britannica.com": "Encyclopaedia Britannica",
  "etymonline.com": "Online Etymology Dictionary",
  "noaa.gov": "NOAA",
  "usgs.gov": "USGS",
  "esa.int": "ESA",
  "bbc.com": "BBC",
  "bbc.co.uk": "BBC",
  "smithsonianmag.com": "Smithsonian Magazine",
  "loc.gov": "Library of Congress",
  "nps.gov": "US National Park Service",
  "un.org": "United Nations",
  "worldbank.org": "World Bank",
  "oecd.org": "OECD",
  "imf.org": "IMF",
};

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The publisher label to display for a source URL. Never accepts a caller
 * supplied name — that is the whole point.
 */
export function publisherForUrl(url: string): string {
  const host = hostOf(url);
  if (!host) return "Source";
  if (KNOWN_PUBLISHERS[host]) return KNOWN_PUBLISHERS[host];

  // Try the registrable parent (blog.example.org -> example.org) before
  // falling back to showing the host verbatim.
  const parts = host.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join(".");
    if (KNOWN_PUBLISHERS[parent]) return KNOWN_PUBLISHERS[parent];
  }
  return host;
}

export type StoredSource = { title: string; publisher: string; url: string };

/**
 * Rewrite a card's sources so every publisher matches its URL. Applied at
 * import time and by the one-off repair script for rows already in the DB.
 */
export function normalizeSources(sources: StoredSource[]): StoredSource[] {
  return sources.map((s) => ({ ...s, publisher: publisherForUrl(s.url) }));
}

/**
 * True when a source's model-supplied publisher misrepresents its URL — used
 * only for reporting how much of the bank was affected.
 */
export function isMisattributed(source: StoredSource): boolean {
  return source.publisher.trim() !== publisherForUrl(source.url);
}
