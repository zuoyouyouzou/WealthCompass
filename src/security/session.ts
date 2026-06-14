export const LOCK_TIMEOUT_KEY = "wealth-compass-lock-timeout";

export function getLockTimeoutMinutes(): number {
  const stored = Number(localStorage.getItem(LOCK_TIMEOUT_KEY));
  return [5, 10, 15, 30].includes(stored) ? stored : 10;
}

export function setLockTimeoutMinutes(minutes: number): void {
  if (![5, 10, 15, 30].includes(minutes)) {
    throw new Error("不支持的自动锁定时间");
  }
  localStorage.setItem(LOCK_TIMEOUT_KEY, String(minutes));
}
