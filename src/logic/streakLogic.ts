export function calcWinStreak(
  lastPlayedDate: string,
  yesterday: string,
  currentStreak: number,
  won: boolean
): number {
  if (!won) return 0
  return lastPlayedDate === yesterday ? currentStreak + 1 : 1
}

export function calcParticipationStreak(
  lastParticipationDate: string,
  yesterday: string,
  participationStreak: number
): number {
  return lastParticipationDate === yesterday ? participationStreak + 1 : 1
}

export function calcWinsAfterLoss(prevWinsAfterLoss: number, won: boolean): number {
  return won ? prevWinsAfterLoss + 1 : 0
}
