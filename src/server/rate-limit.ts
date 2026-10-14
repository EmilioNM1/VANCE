/**
 * Limitador en memoria por proceso (ventana fija). Suficiente para una instancia;
 * para despliegues con varias réplicas debe sustituirse por uno compartido (p. ej. Redis).
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count++;
  return b.count <= limit;
}
