import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWeeklyHistory, selectWeeklyClose, weeklyCutoffDate, weeklyHistoryUrl } from '../src/history.ts';
import { CATALOG } from '../src/catalog.ts';
import { parseMoex } from '../src/model.ts';
import type { Snapshot } from '../src/model.ts';

const history = (rows: unknown[][]) => ({ history: { columns: ['TRADEDATE', 'CLOSE'], data: rows } });
const ok = (body: unknown) => ({ ok: true, json: async () => body });
const snapshot = (tickers = ['SBER']): Snapshot => ({
  fetchedAt: '2026-10-29T12:00:00Z',
  stocks: tickers.map((ticker) => ({ ticker, name: ticker, sector: 'Финансы', price: 110, change: 1, turnover: 1000, marketCap: 2000, updatedAt: '2026-10-29 14:50:00', quoteTime: '14:35:00' })),
});
const reference = (ticker = 'SBER', close = 100) => ({ ticker, cutoffDate: '2026-10-22', date: '2026-10-22', close, source: weeklyHistoryUrl(ticker, '2026-10-22') });
const seed = (...references: ReturnType<typeof reference>[]) => ({ fetchedAt: '2026-10-29T12:00:00Z', references });
const approximately = (actual: number | null | undefined, expected: number) => assert.ok(actual != null && Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('calendar-week cutoff uses feed Moscow date and falls back only when the timestamp is invalid', () => {
  assert.equal(weeklyCutoffDate('2026-10-29 23:00:00', '2026-11-02T00:00:00Z'), '2026-10-22');
  assert.equal(weeklyCutoffDate('2026-11-01T22:30:00Z', ''), '2026-10-26');
  assert.equal(weeklyCutoffDate('2026-11-07', ''), '2026-10-31');
  assert.equal(weeklyCutoffDate('', '2026-10-29T21:30:00Z'), '2026-10-23');
  assert.equal(weeklyCutoffDate('2026-02-30 12:00:00', '2026-03-01T12:00:00Z'), '2026-02-22');
  assert.equal(weeklyCutoffDate('invalid', 'invalid'), null);
});

test('weekend and holiday references use the nearest earlier positive close', () => {
  assert.deepEqual(selectWeeklyClose(history([['2026-10-29', 98], ['2026-10-30', 100]]), '2026-10-31'), { date: '2026-10-30', close: 100 });
  assert.deepEqual(selectWeeklyClose(history([['2025-12-29', 98], ['2025-12-30', 100], ['2026-01-06', null]]), '2026-01-07'), { date: '2025-12-30', close: 100 });
});

test('history joins columns, handles unordered rows and excludes future/invalid closes', () => {
  const payload = { history: { columns: ['CLOSE', 'TRADEDATE'], data: [[100, '2026-10-21'], [90, '2026-10-20'], [120, '2026-10-23'], [0, '2026-10-22'], [-1, '2026-10-22'], [Infinity, '2026-10-22'], ['', '2026-10-22'], [true, '2026-10-22'], [null, '2026-10-22'], [111, '2026-99-00']] } };
  assert.deepEqual(selectWeeklyClose(payload, '2026-10-22'), { date: '2026-10-21', close: 100 });
  assert.deepEqual(selectWeeklyClose(history([['2026-10-22', '101.2']]), '2026-10-22'), { date: '2026-10-22', close: 101.2 });
  assert.equal(selectWeeklyClose(history([['2026-10-23', 100]]), '2026-10-22'), null);
});

test('malformed history rejects, while a valid empty table means no available close', () => {
  for (const payload of [null, {}, { history: {} }, { history: { columns: ['TRADEDATE'], data: [] } }, { history: { columns: ['TRADEDATE', 'CLOSE'], data: ['wrong'] } }]) assert.throws(() => selectWeeklyClose(payload, '2026-10-22'));
  assert.equal(selectWeeklyClose(history([]), '2026-10-22'), null);
  assert.throws(() => weeklyHistoryUrl('SBER', 'invalid'));
});

test('history request bounds its reference window and cannot request a later close', () => {
  const url = new URL(weeklyHistoryUrl('SBER', '2026-10-22'));
  assert.equal(url.hostname, 'iss.moex.com');
  assert.equal(url.searchParams.get('from'), '2026-09-22');
  assert.equal(url.searchParams.get('till'), '2026-10-22');
  assert.equal(url.searchParams.get('history.columns'), 'TRADEDATE,CLOSE');
});

test('bundled official references cover the entire saved heatmap', () => {
  const saved = JSON.parse(readFileSync(new URL('../src/snapshot.json', import.meta.url), 'utf8'));
  const savedWeekly = JSON.parse(readFileSync(new URL('../src/weekly-snapshot.json', import.meta.url), 'utf8'));
  const enriched = createWeeklyHistory(savedWeekly).withCachedWeekly(parseMoex(saved.payload, saved.fetchedAt));
  assert.equal(savedWeekly.references.length, CATALOG.length);
  assert.equal(new Set(savedWeekly.references.map((row: { ticker: string }) => row.ticker)).size, CATALOG.length);
  for (const stock of enriched.stocks) {
    const row = savedWeekly.references.find((item: { ticker: string }) => item.ticker === stock.ticker);
    assert.ok(row.date <= row.cutoffDate);
    assert.match(row.source, /^https:\/\/iss\.moex\.com\//);
    approximately(stock.changeWeek, (stock.price / row.close - 1) * 100);
    assert.equal(stock.weekReferenceDate, row.date);
  }
});

test('cached reference recalculates weekly change for each latest price without fetching', async () => {
  let requests = 0;
  const store = createWeeklyHistory(seed(reference()), async () => { requests++; return ok(history([])); });
  const input = snapshot();
  approximately(store.withCachedWeekly(input).stocks[0].changeWeek, 10);
  input.stocks[0].price = 120;
  approximately((await store.loadWeeklyHistory(input)).stocks[0].changeWeek, 20);
  assert.equal(requests, 0);
  assert.equal(input.stocks[0].changeWeek, undefined);
});

test('new feed dates request a new reference instead of reusing the old week', async () => {
  const urls: string[] = [];
  const store = createWeeklyHistory(seed(reference()), async (url) => { urls.push(url); return ok(history([['2026-10-23', 110]])); });
  const input = snapshot(); input.stocks[0].updatedAt = '2026-10-30 12:00:00';
  assert.equal(store.withCachedWeekly(input).stocks[0].changeWeek, null);
  const enriched = await store.loadWeeklyHistory(input);
  assert.equal(enriched.stocks[0].changeWeek, 0);
  assert.equal(enriched.stocks[0].weekReferenceDate, '2026-10-23');
  assert.equal(new URL(urls[0]).searchParams.get('till'), '2026-10-23');
});

test('history failures preserve daily quotes and known weekly references, then retry', async () => {
  let requests = 0;
  const store = createWeeklyHistory(seed(reference()), async () => {
    if (++requests === 1) throw new Error('offline');
    return ok(history([['2026-10-22', 55]]));
  });
  const input = snapshot(['SBER', 'GAZP']);
  const failed = await store.loadWeeklyHistory(input);
  approximately(failed.stocks[0].changeWeek, 10);
  assert.equal(failed.stocks[1].changeWeek, null);
  assert.equal(failed.stocks[1].price, 110);
  assert.equal(failed.stocks[1].change, 1);
  assert.equal(failed.stocks[1].turnover, 1000);
  approximately((await store.loadWeeklyHistory(input)).stocks[1].changeWeek, 100);
  await store.loadWeeklyHistory(input);
  assert.equal(requests, 2);
});

test('HTTP and malformed-response failures retry, while valid missing history stays unknown', async () => {
  for (const first of [{ ok: false, json: async () => ({}) }, ok({ history: {} })]) {
    let requests = 0;
    const store = createWeeklyHistory(undefined, async () => ++requests === 1 ? first : ok(history([['2026-10-22', 100]])));
    assert.equal((await store.loadWeeklyHistory(snapshot())).stocks[0].changeWeek, null);
    approximately((await store.loadWeeklyHistory(snapshot())).stocks[0].changeWeek, 10);
    assert.equal(requests, 2);
  }
  let requests = 0;
  const store = createWeeklyHistory(undefined, async () => { requests++; return ok(history([])); });
  assert.equal((await store.loadWeeklyHistory(snapshot())).stocks[0].changeWeek, null);
  assert.equal((await store.loadWeeklyHistory(snapshot())).stocks[0].changeWeek, null);
  assert.equal(requests, 1);
});

test('invalid prices, invalid seed references and numeric overflow remain unknown', () => {
  const store = createWeeklyHistory(seed(reference()));
  for (const price of [0, -1, NaN, Infinity]) {
    const input = snapshot(); input.stocks[0].price = price;
    assert.equal(store.withCachedWeekly(input).stocks[0].changeWeek, null);
  }
  for (const row of [{ ...reference(), date: '2026-10-23' }, reference('SBER', 0), reference('SBER', Infinity)]) assert.equal(createWeeklyHistory(seed(row)).withCachedWeekly(snapshot()).stocks[0].changeWeek, null);
  assert.equal(createWeeklyHistory(seed(reference('SBER', Number.MIN_VALUE))).withCachedWeekly(snapshot()).stocks[0].changeWeek, null);
});

test('loader bounds concurrency to six and de-duplicates the same ticker/cutoff', async () => {
  let active = 0; let maximum = 0; let requests = 0;
  const store = createWeeklyHistory(undefined, async () => {
    requests++; maximum = Math.max(maximum, ++active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    return ok(history([['2026-10-22', 100]]));
  });
  const input = snapshot([...Array.from({ length: 14 }, (_, index) => `TEST${index}`), 'TEST0']);
  const enriched = await store.loadWeeklyHistory(input);
  assert.equal(requests, 14);
  assert.equal(maximum, 6);
  assert.ok(enriched.stocks.every((stock) => stock.changeWeek !== null));
});

test('abort prevents queued requests, preserves cached values, and allows a later retry', async () => {
  let requests = 0; let waitForAbort = true;
  const store = createWeeklyHistory(seed(reference()), async (_url, { signal }) => {
    requests++;
    if (waitForAbort) await new Promise((_, reject) => signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    return ok(history([['2026-10-22', 100]]));
  });
  const input = snapshot(['SBER', ...Array.from({ length: 12 }, (_, index) => `TEST${index}`)]);
  const controller = new AbortController();
  const pending = store.loadWeeklyHistory(input, controller.signal);
  controller.abort();
  const interrupted = await pending;
  assert.equal(requests, 6);
  approximately(interrupted.stocks[0].changeWeek, 10);
  assert.ok(interrupted.stocks.slice(1).every((stock) => stock.changeWeek === null));
  await store.loadWeeklyHistory(input, controller.signal);
  assert.equal(requests, 6);
  waitForAbort = false;
  const retried = await store.loadWeeklyHistory(input);
  assert.equal(requests, 18);
  assert.ok(retried.stocks.every((stock) => stock.changeWeek !== null));
});
