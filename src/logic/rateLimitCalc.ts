export function isWindowExpired(
  windowStartIso: string,
  windowSeconds: number,
  nowMs?: number
): boolean {
  const now = nowMs ?? Date.now()
  const cutoff = new Date(now - windowSeconds * 1000)
  return new Date(windowStartIso) < cutoff
}

export function isRateLimited(count: number, maxRequests: number): boolean {
  return count >= maxRequests
}

export function calcRetryAfterSeconds(
  windowStartIso: string,
  windowSeconds: number,
  nowMs?: number
): number {
  const now = nowMs ?? Date.now()
  const windowEnds = new Date(new Date(windowStartIso).getTime() + windowSeconds * 1000)
  return Math.ceil((windowEnds.getTime() - now) / 1000)
}
