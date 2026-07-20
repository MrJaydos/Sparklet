// Domains known to gate the actual article/paper text behind a subscription
// or institutional login. A source only supports "fact-checked cards with
// real sources" if it can actually be read — both by the cross-model
// fact-checker at import time and by a reader tapping through — so cards
// citing one of these are excluded automatically instead of landing in the
// admin review queue for a manual look every time.
const PAYWALLED_DOMAINS = [
  // News / magazines
  "wsj.com",
  "nytimes.com",
  "ft.com",
  "economist.com",
  "washingtonpost.com",
  "bloomberg.com",
  "thetimes.co.uk",
  "telegraph.co.uk",
  "newyorker.com",
  "theathletic.com",
  "businessinsider.com",
  "barrons.com",
  "hbr.org",
  "foreignpolicy.com",
  // Academic publishers (abstract free, full text gated)
  "sciencedirect.com",
  "springer.com",
  "academic.oup.com",
  "sagepub.com",
  "tandfonline.com",
  "wiley.com",
  "jstor.org",
  "cell.com",
  "nejm.org",
  "thelancet.com",
  "ieeexplore.ieee.org",
  "dl.acm.org",
  "degruyter.com",
  "psycnet.apa.org",
];

const PAYWALLED_SET = new Set(PAYWALLED_DOMAINS);

/** Matches the exact domain or any of its subdomains (e.g. "link.springer.com"). */
export function isPaywalledUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  return PAYWALLED_SET.has(hostname) || PAYWALLED_DOMAINS.some((d) => hostname.endsWith(`.${d}`));
}
