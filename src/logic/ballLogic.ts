export interface BallCheckInput {
  completionState: 'won' | 'lost' | 'playing'
  guessCount: number
  partStreak: number
  waterBugCount: number
  isWaterOrBug: boolean
  winsAfterLoss: number
  hasProfile: boolean
}

export function checkBallUnlocks(input: BallCheckInput): string[] {
  const { completionState, guessCount, partStreak, waterBugCount, isWaterOrBug, winsAfterLoss, hasProfile } = input
  const won = completionState === 'won'
  const balls: string[] = []

  if (won && guessCount <= 2) balls.push('quick-ball')
  if (won && guessCount === 10) balls.push('timer-ball')
  if (isWaterOrBug && waterBugCount >= 10) balls.push('net-ball')
  if (partStreak >= 7 && hasProfile) balls.push('luxury-ball')
  if (winsAfterLoss >= 3) balls.push('heal-ball')

  return balls
}
