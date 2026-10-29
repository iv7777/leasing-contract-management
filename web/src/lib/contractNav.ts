/** The contract list as you saw it (filters and all), kept for the session so a contract page can step to the
 * previous / next one in that same order. */
const KEY = "lcm.contractOrder";

export function saveContractOrder(ids: number[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Private mode or blocked storage: the contract page then uses the full list.
  }
}

export function loadContractOrder(): number[] | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    return Array.isArray(v) && v.every((x) => typeof x === "number") ? v : null;
  } catch {
    return null;
  }
}
