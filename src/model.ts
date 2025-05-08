import { CATALOG } from './catalog.ts';
export type Stock = { ticker: string; name: string; sector: string; price: number; change: number | null; changeWeek?: number | null; weekReferenceDate?: string; marketCap: number; turnover: number; updatedAt: string; quoteTime: string };
export type Snapshot = { fetchedAt: string; stocks: Stock[] };
export type SizeMetric = 'marketCap' | 'turnover';
export type ColorMetric = 'change' | 'changeWeek' | 'turnover';
export const METRIC_LABELS = { change: 'Change 1D, %', changeWeek: 'Change 1W, %', turnover: 'Turnover 1D, ₽', marketCap: 'Market cap, ₽' } as const;
type Table = { columns: string[]; data: unknown[][] };
const numeric = (value: unknown): number | null => value !== null && value !== '' && (typeof value === 'number' || typeof value === 'string') && Number.isFinite(Number(value)) ? Number(value) : null;
function readTable(value: unknown, required: string[]): Table {
  if (!value || typeof value !== 'object') throw new Error('Некорректный ответ MOEX');
  const table = value as Table;
  if (!Array.isArray(table.columns) || !table.columns.every((v) => typeof v === 'string') || !Array.isArray(table.data) || !table.data.every(Array.isArray) || !required.every((field) => table.columns.includes(field))) throw new Error('Некорректные столбцы MOEX');
  return table;
}
export function parseMoex(value: unknown, fetchedAt = new Date().toISOString()): Snapshot {
  if (!value || typeof value !== 'object') throw new Error('Нет данных MOEX');
  const input = value as Record<string, unknown>;
  const securities = readTable(input.securities, ['SECID', 'PREVPRICE', 'ISSUESIZE']);
  const market = readTable(input.marketdata, ['SECID', 'LAST', 'LASTTOPREVPRICE', 'VALTODAY', 'ISSUECAPITALIZATION', 'SYSTIME', 'UPDATETIME']);
  const sec = new Map(securities.data.map((row) => [row[securities.columns.indexOf('SECID')], Object.fromEntries(securities.columns.map((column, i) => [column, row[i]]))]));
  const md = new Map(market.data.map((row) => [row[market.columns.indexOf('SECID')], Object.fromEntries(market.columns.map((column, i) => [column, row[i]]))]));
  const stocks: Stock[] = [];
  for (const [ticker, name, sector] of CATALOG) {
    const row = md.get(ticker); const info = sec.get(ticker);
    if (!row || !info) continue;
    const price = numeric(row.LAST);
    const cap = numeric(row.ISSUECAPITALIZATION) ?? (price !== null && numeric(info.ISSUESIZE) !== null ? price * Number(info.ISSUESIZE) : null);
    if (price === null || price <= 0 || cap === null || !Number.isFinite(cap) || cap <= 0) continue;
    const previous = numeric(info.PREVPRICE);
    const change = numeric(row.LASTTOPREVPRICE) ?? (previous !== null && previous > 0 ? (price / previous - 1) * 100 : null);
    stocks.push({ ticker, name, sector, price, change: change !== null && Number.isFinite(change) ? change : null, marketCap: cap, turnover: Math.max(0, numeric(row.VALTODAY) ?? 0), updatedAt: typeof row.SYSTIME === 'string' ? row.SYSTIME : '', quoteTime: typeof row.UPDATETIME === 'string' ? row.UPDATETIME : '' });
  }
  if (!stocks.length) throw new Error('MOEX не вернул котировки выбранных акций');
  return { fetchedAt, stocks };
}
export const MOEX_URL = 'https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off&iss.only=securities,marketdata&securities.columns=SECID,SECNAME,PREVPRICE,ISSUESIZE&marketdata.columns=SECID,LAST,LASTTOPREVPRICE,VALTODAY,ISSUECAPITALIZATION,SYSTIME,UPDATETIME';
export function formatChange(value: number | null | undefined): string { return value == null || !Number.isFinite(value) ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2).replace('.', ',')}%`; }
export const money = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
export function compactMoney(value: number): string { return value >= 1e12 ? `${money(value / 1e12)} трлн ₽` : value >= 1e9 ? `${money(value / 1e9)} млрд ₽` : value >= 1e6 ? `${money(value / 1e6)} млн ₽` : `${money(value)} ₽`; }
export function formatMetric(stock: Stock, metric: ColorMetric): string { return metric === 'turnover' ? compactMoney(stock.turnover) : formatChange(stock[metric]); }

export function formatTimestamp(value: string): string {
  const normalized = value.replace(' ', 'T') + (value.includes('Z') || /[+-]\d\d:\d\d$/.test(value) ? '' : '+03:00');
  const date = new Date(normalized);
  if (!value || !Number.isFinite(date.getTime())) return 'unknown time';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date) + ' MSK';
}
