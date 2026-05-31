// Multi-currency conversion via the free, key-less ExchangeRate-API endpoint:
//   https://open.er-api.com/v6/latest/{BASE}
// The response shape is: { result: "success", base_code, rates: { USD: 1, ... } }
// rates[X] means "1 BASE = rates[X] of X".

interface ErApiResponse {
  result: "success" | "error";
  "error-type"?: string;
  base_code?: string;
  rates?: Record<string, number>;
}

/**
 * Returns how many units of `to` equal one unit of `from`
 * (i.e. baseAmount = originalAmount * rate). Returns 1 when currencies match.
 */
export async function getExchangeRate(from: string, to: string): Promise<number> {
  if (from === to) return 1;

  let res: Response;
  try {
    res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`);
  } catch {
    throw new Error("Could not reach the exchange-rate service. Check your connection.");
  }
  if (!res.ok) {
    throw new Error(`Exchange-rate service error (HTTP ${res.status}).`);
  }

  const data = (await res.json()) as ErApiResponse;
  if (data.result !== "success" || !data.rates) {
    throw new Error(`Exchange rate unavailable for ${from} (${data["error-type"] ?? "unknown"}).`);
  }

  const rate = data.rates[to];
  if (typeof rate !== "number" || !(rate > 0)) {
    throw new Error(`No exchange rate found from ${from} to ${to}.`);
  }
  return rate;
}
