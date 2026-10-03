export function logInfo(fn: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ fn, ...fields }));
}

export function logWarn(fn: string, fields: Record<string, unknown> = {}): void {
  console.warn(JSON.stringify({ fn, ...fields }));
}

export function logError(fn: string, fields: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ fn, ...fields }));
}
