// =============================================================================
// Debt simplification — pure, side-effect-free algorithm module.
//
// Kept separate from the HTTP handler so it can be unit-tested in isolation
// and reused elsewhere (e.g. a future settlement preview on the client).
//
// All amounts here are INTEGERS in a currency's minor unit (e.g. cents). Working
// in integers avoids floating-point accumulation drift; the caller scales to and
// from decimals at the boundary.
// =============================================================================

/** A user's net balance. amount > 0 => owed money (creditor); < 0 => owes (debtor). */
export interface Balance {
  userId: string;
  amount: number; // integer minor units
}

/** A single transfer in the settlement plan: `from` pays `to` `amount`. */
export interface Transfer {
  from: string;
  to: string;
  amount: number; // integer minor units, always > 0
}

// ---------------------------------------------------------------------------
// A small binary max-heap. Standard library has no priority queue, and the
// greedy step needs "give me the current largest" repeatedly as values change.
// ---------------------------------------------------------------------------
class MaxHeap<T> {
  private items: T[] = [];
  private readonly compare: (a: T, b: T) => number;

  constructor(compare: (a: T, b: T) => number) {
    this.compare = compare;
  }

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): T | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last !== undefined) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.compare(this.items[i], this.items[parent]) <= 0) break;
      [this.items[i], this.items[parent]] = [this.items[parent], this.items[i]];
      i = parent;
    }
  }

  private bubbleDown(i: number): void {
    const n = this.items.length;
    for (;;) {
      let largest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.compare(this.items[left], this.items[largest]) > 0) largest = left;
      if (right < n && this.compare(this.items[right], this.items[largest]) > 0) largest = right;
      if (largest === i) break;
      [this.items[i], this.items[largest]] = [this.items[largest], this.items[i]];
      i = largest;
    }
  }
}

/**
 * Greedy debt simplification.
 *
 * Strategy: repeatedly settle the single biggest debtor against the single
 * biggest creditor. Each transfer zeroes out at least one of the two parties,
 * so the plan never needs more than (N - 1) transfers for N people with a
 * non-zero balance — a large reduction versus the raw pairwise debt list.
 *
 * Note: this minimizes transfers heuristically. Finding the provably minimal
 * number of transfers is NP-hard (it reduces to subset-sum/partition), but the
 * "biggest-vs-biggest" greedy is the standard, fast, near-optimal approach and
 * is optimal for the common cases (chains, single creditor, etc.).
 */
export function simplifyDebts(balances: Balance[]): Transfer[] {
  // Max-heaps keyed by magnitude. Debtors stored as positive "amount owed".
  const creditors = new MaxHeap<Balance>((a, b) => a.amount - b.amount);
  const debtors = new MaxHeap<Balance>((a, b) => a.amount - b.amount);

  for (const b of balances) {
    if (b.amount > 0) creditors.push({ userId: b.userId, amount: b.amount });
    else if (b.amount < 0) debtors.push({ userId: b.userId, amount: -b.amount });
    // amount === 0 => already settled, ignored.
  }

  const transfers: Transfer[] = [];

  while (creditors.size > 0 && debtors.size > 0) {
    const creditor = creditors.pop()!; // owed the most
    const debtor = debtors.pop()!; // owes the most
    const settled = Math.min(creditor.amount, debtor.amount);

    transfers.push({ from: debtor.userId, to: creditor.userId, amount: settled });

    const creditorRemaining = creditor.amount - settled;
    const debtorRemaining = debtor.amount - settled;

    // The party with the larger balance survives with the remainder.
    if (creditorRemaining > 0) creditors.push({ userId: creditor.userId, amount: creditorRemaining });
    if (debtorRemaining > 0) debtors.push({ userId: debtor.userId, amount: debtorRemaining });
  }

  return transfers;
}
