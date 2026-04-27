export function isStaleSession(
  requestVersion: number | undefined,
  sessionVersion: number
): boolean {
  return requestVersion !== undefined && requestVersion !== sessionVersion
}
