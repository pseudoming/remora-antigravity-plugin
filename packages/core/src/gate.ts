import {
  getRuntimeHookValue,
  setRuntimeHookValue,
  deleteRuntimeHookValue,
} from "./storage/runtime-state";

/**
 * Returns True if stored value != given value (or no stored value).
 */
export function shouldFire(
  convId: string,
  key: string,
  value: unknown
): boolean {
  const prev = getRuntimeHookValue(convId, -1, key);
  return String(prev) !== String(value);
}

/**
 * Record that this gate has fired for this value.
 */
export function markFired(
  convId: string,
  key: string,
  value: unknown
): void {
  setRuntimeHookValue(convId, -1, key, String(value));
}

/**
 * Returns True if this exact value was already recorded (same-window dedup).
 */
export function isDuplicate(
  convId: string,
  key: string,
  value: unknown
): boolean {
  const prev = getRuntimeHookValue(convId, -1, key);
  return String(prev) === String(value);
}

/**
 * Delete old record if stored value differs from new_value (cross-window re-alert).
 */
export function clearStale(
  convId: string,
  key: string,
  newValue: unknown
): void {
  const prev = getRuntimeHookValue(convId, -1, key);
  if (prev && String(prev) !== String(newValue)) {
    deleteRuntimeHookValue(convId, -1, key);
  }
}

/**
 * Returns True every 5th user input.
 */
export function shouldInjectTone(userInputCount: number): boolean {
  return userInputCount % 5 === 0;
}
