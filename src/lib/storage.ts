// Small preferences kept in the browser. Storage can be unavailable (private windows, blocked
// site data), so every access is guarded and the default applies.
export function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

export function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch { /* storage unavailable */ }
}
