// Streak tiers: the standard balls a win streak climbs through.
export const TIER_ORDER = ['poke-ball', 'great-ball', 'ultra-ball', 'master-ball']

export const TIER_THRESHOLDS: Record<string, number> = {
  'poke-ball': 0,
  'great-ball': 3,
  'ultra-ball': 7,
  'master-ball': 14,
}

export function getStreakTier(streak: number): string {
  if (streak >= TIER_THRESHOLDS['master-ball']) return 'master-ball'
  if (streak >= TIER_THRESHOLDS['ultra-ball']) return 'ultra-ball'
  if (streak >= TIER_THRESHOLDS['great-ball']) return 'great-ball'
  return 'poke-ball'
}

/** The next tier above the streak's current one, or null at the max tier. */
export function nextTier(streak: number): { tierId: string; threshold: number } | null {
  const idx = TIER_ORDER.indexOf(getStreakTier(streak))
  const tierId = TIER_ORDER[idx + 1]
  return tierId ? { tierId, threshold: TIER_THRESHOLDS[tierId] } : null
}

/** Tier rank of a ball; achievement balls rank with the base Poké Ball. */
export function tierRank(ballId: string): number {
  return Math.max(0, TIER_ORDER.indexOf(ballId))
}

/** The tier ball to offer as an upgrade over the equipped ball, or null for no prompt. */
export function getTierUpgradePrompt(
  streak: number,
  displayBall: string | null | undefined,
  dismissedForever: boolean,
): string | null {
  if (dismissedForever) return null
  const currentTier = getStreakTier(streak)
  if (currentTier === 'poke-ball') return null
  return tierRank(currentTier) > tierRank(displayBall ?? 'poke-ball') ? currentTier : null
}
