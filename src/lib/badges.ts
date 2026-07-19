// Milestone badges, computed live from existing aggregates on every profile
// load — no dedicated table, no write path. Thresholds are just editorial.

export type BadgeTier = { threshold: number; label: string };

export type BadgeGroup = {
  key: string;
  icon: string;
  name: string;
  tiers: BadgeTier[]; // ascending thresholds
};

export const BADGE_GROUPS: BadgeGroup[] = [
  {
    key: "cards",
    icon: "📖",
    name: "Cards learned",
    tiers: [
      { threshold: 10, label: "Curious" },
      { threshold: 50, label: "Scholar" },
      { threshold: 200, label: "Bookworm" },
      { threshold: 1000, label: "Encyclopedia" },
    ],
  },
  {
    key: "streak",
    icon: "🔥",
    name: "Longest streak",
    tiers: [
      { threshold: 3, label: "Warming up" },
      { threshold: 7, label: "One week" },
      { threshold: 30, label: "One month" },
      { threshold: 100, label: "Centurion" },
    ],
  },
  {
    key: "quiz",
    icon: "🧠",
    name: "Quizzes aced",
    tiers: [
      { threshold: 10, label: "Sharp" },
      { threshold: 50, label: "Quizmaster" },
      { threshold: 200, label: "Genius" },
    ],
  },
  {
    key: "categories",
    icon: "🧭",
    name: "Topics explored",
    tiers: [
      { threshold: 3, label: "Explorer" },
      { threshold: 6, label: "Wanderer" },
      { threshold: 10, label: "Cartographer" },
    ],
  },
  {
    key: "notebook",
    icon: "🔖",
    name: "Cards saved",
    tiers: [
      { threshold: 10, label: "Collector" },
      { threshold: 50, label: "Archivist" },
    ],
  },
  {
    key: "guess",
    icon: "🎯",
    name: "Guesses made",
    tiers: [
      { threshold: 10, label: "Predictor" },
      { threshold: 50, label: "Oracle" },
    ],
  },
];

export type BadgeStatus = {
  key: string;
  icon: string;
  name: string;
  value: number;
  earnedTier: BadgeTier | null;
  nextTier: BadgeTier | null;
};

export function computeBadges(stats: Record<string, number>): BadgeStatus[] {
  return BADGE_GROUPS.map((g) => {
    const value = stats[g.key] ?? 0;
    let earnedTier: BadgeTier | null = null;
    let nextTier: BadgeTier | null = null;
    for (const tier of g.tiers) {
      if (value >= tier.threshold) earnedTier = tier;
      else {
        nextTier = tier;
        break;
      }
    }
    return { key: g.key, icon: g.icon, name: g.name, value, earnedTier, nextTier };
  });
}
