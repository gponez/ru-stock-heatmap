import type { Snapshot } from './model.ts';

export type WeeklyReference = { ticker: string; cutoffDate: string; date: string; close: number; source: string };
export type WeeklySnapshot = { fetchedAt: string; references: readonly WeeklyReference[] };
type Close = { date: string; close: number };
type FetchHistory = (url: string, options: { signal?: AbortSignal }) => Promise<Pick<Response, 'ok' | 'json'>>;
const moscowDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' });

function validDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dayOf(value: string): string | null {
  if (!validDay(value.slice(0, 10))) return null;
  const normalized = value.length === 10 ? `${value}T00:00:00+03:00` : value.replace(' ', 'T') + (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? '' : '+03:00');
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) return null;
  const parts = moscowDate.formatToParts(parsed);
  return ['year', 'month', 'day'].map((part) => parts.find((item) => item.type === part)!.value).join('-');
}

function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Seven calendar days before the displayed feed's Moscow date, including on weekends. */
export function weeklyCutoffDate(updatedAt: string, fetchedAt: string): string | null {
  const day = dayOf(updatedAt) ?? dayOf(fetchedAt);
  return day === null ? null : shiftDay(day, -7);
}

export function weeklyHistoryUrl(ticker: string, cutoffDate: string): string {
  if (!validDay(cutoffDate)) throw new Error('Invalid weekly reference date');
  return `https://iss.moex.com/iss/history/engines/stock/markets/shares/boards/TQBR/securities/${encodeURIComponent(ticker)}.json?from=${shiftDay(cutoffDate, -30)}&till=${cutoffDate}&iss.meta=off&iss.only=history&history.columns=TRADEDATE,CLOSE`;
}

/** Holidays use the latest available positive CLOSE before the cutoff, never a later close. */
export function selectWeeklyClose(payload: unknown, cutoffDate: string): Close | null {
  if (!validDay(cutoffDate) || !payload || typeof payload !== 'object') throw new Error('Invalid weekly history');
  const history = (payload as Record<string, unknown>).history as { columns?: unknown; data?: unknown } | undefined;
  if (!history || !Array.isArray(history.columns) || !Array.isArray(history.data)) throw new Error('Invalid weekly history');
  const dayColumn = history.columns.indexOf('TRADEDATE');
  const closeColumn = history.columns.indexOf('CLOSE');
  if (dayColumn < 0 || closeColumn < 0 || !history.data.every(Array.isArray)) throw new Error('Invalid weekly history columns');
  let chosen: Close | null = null;
  for (const row of history.data as unknown[][]) {
    const day = row[dayColumn]; const rawClose = row[closeColumn];
    const close = (typeof rawClose === 'number' || typeof rawClose === 'string' && rawClose.trim() !== '') ? Number(rawClose) : NaN;
    if (validDay(day) && day <= cutoffDate && Number.isFinite(close) && close > 0 && (!chosen || day > chosen.date)) chosen = { date: day, close };
  }
  return chosen;
}

export function createWeeklyHistory(seed?: WeeklySnapshot, fetchHistory: FetchHistory = fetch) {
  // Cache by reference date; current prices remain live and percentage changes are recomputed.
  const cache = new Map<string, Close | null>();
  const keyOf = (ticker: string, cutoffDate: string) => `${ticker}:${cutoffDate}`;
  for (const reference of seed?.references ?? []) {
    if (validDay(reference.cutoffDate) && validDay(reference.date) && reference.date <= reference.cutoffDate && Number.isFinite(reference.close) && reference.close > 0) {
      cache.set(keyOf(reference.ticker, reference.cutoffDate), { date: reference.date, close: reference.close });
    }
  }

  function withCachedWeekly(snapshot: Snapshot): Snapshot {
    return {
      ...snapshot,
      stocks: snapshot.stocks.map((stock) => {
        const cutoffDate = weeklyCutoffDate(stock.updatedAt, snapshot.fetchedAt);
        const reference = cutoffDate ? cache.get(keyOf(stock.ticker, cutoffDate)) : null;
        const change = reference && Number.isFinite(stock.price) && stock.price > 0 ? (stock.price / reference.close - 1) * 100 : NaN;
        return { ...stock, changeWeek: Number.isFinite(change) ? change : null, weekReferenceDate: reference?.date };
      }),
    };
  }

  async function loadWeeklyHistory(snapshot: Snapshot, signal?: AbortSignal): Promise<Snapshot> {
    const missing = new Map<string, { ticker: string; cutoffDate: string }>();
    for (const stock of snapshot.stocks) {
      const cutoffDate = weeklyCutoffDate(stock.updatedAt, snapshot.fetchedAt);
      if (cutoffDate && !cache.has(keyOf(stock.ticker, cutoffDate))) missing.set(keyOf(stock.ticker, cutoffDate), { ticker: stock.ticker, cutoffDate });
    }
    const queue = [...missing];
    let next = 0;
    async function worker() {
      while (!signal?.aborted && next < queue.length) {
        const [key, { ticker, cutoffDate }] = queue[next++];
        try {
          const response = await fetchHistory(weeklyHistoryUrl(ticker, cutoffDate), { signal });
          if (!response.ok) continue;
          const reference = selectWeeklyClose(await response.json(), cutoffDate);
          if (!signal?.aborted && !cache.has(key)) cache.set(key, reference);
        } catch {
          // A history outage must not discard the current price/turnover feed. Retry next time.
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, queue.length) }, () => worker()));
    return withCachedWeekly(snapshot);
  }

  return { withCachedWeekly, loadWeeklyHistory };
}
