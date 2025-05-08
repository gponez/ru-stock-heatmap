import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMoex, formatChange, formatTimestamp } from '../src/model.ts';
const saved = JSON.parse(readFileSync(new URL('../src/snapshot.json', import.meta.url), 'utf8'));
const parsed = parseMoex(saved.payload, saved.fetchedAt);
const fixture = () => ({ securities: { columns: ['SECID', 'PREVPRICE', 'ISSUESIZE'], data: [['SBER', 100, 20]] }, marketdata: { columns: ['SECID','LAST','LASTTOPREVPRICE','VALTODAY','ISSUECAPITALIZATION','SYSTIME','UPDATETIME'], data: [['SBER',110,10,1000,2200,'2026-10-29 12:00:00','11:45:00']] } });
test('real MOEX snapshot parses finite prices and positive capitalization', () => {
  assert.ok(parsed.stocks.length >= 20);
  for (const stock of parsed.stocks) { assert.ok(stock.price > 0); assert.ok(stock.marketCap > 0); assert.ok(stock.turnover >= 0); }
  assert.equal(parsed.fetchedAt, saved.fetchedAt);
});
test('joins on ticker and columns, never array order', () => {
  const input = fixture();
  input.securities.columns.reverse(); input.securities.data[0].reverse();
  input.marketdata.columns.reverse(); input.marketdata.data[0].reverse();
  assert.equal(parseMoex(input).stocks[0].price,110);
  assert.equal(parseMoex(input).stocks[0].change,10);
});
test('null last price is omitted, not replaced with zero or previous close', () => {
  const input = fixture(); input.marketdata.data[0][1] = null as never;
  assert.throws(() => parseMoex(input), /не вернул/);
});
test('missing change and cap are derived from valid reference fields', () => {
  const input = fixture(); input.marketdata.data[0][2] = null as never; input.marketdata.data[0][4] = null as never;
  const stock = parseMoex(input).stocks[0];
  assert.ok(Math.abs(stock.change! - 10) < 1e-10); assert.equal(stock.marketCap,2200);
});
test('unknown change stays unknown and zero change remains zero', () => {
  const input = fixture(); input.marketdata.data[0][2] = null as never; input.securities.data[0][1] = null as never;
  assert.equal(parseMoex(input).stocks[0].change,null);
  input.marketdata.data[0][2] = 0;
  assert.equal(parseMoex(input).stocks[0].change,0);
  assert.equal(formatChange(null),'—'); assert.equal(formatChange(0),'0,00%');
});
test('malformed and empty responses reject, allowing caller to retain snapshot', () => {
  for (const input of [null,{}, {securities:{}}, {securities:{columns:[],data:[]}}, {securities:fixture().securities,marketdata:{columns:fixture().marketdata.columns,data:[]}}]) assert.throws(() => parseMoex(input));
});
test('invalid timestamps cannot crash the fallback status', () => {
  assert.equal(formatTimestamp('invalid'),'unknown time');
  assert.equal(formatTimestamp(''),'unknown time');
  assert.match(formatTimestamp('2026-10-29 12:00:00'),/2026/);
  assert.match(formatTimestamp('2026-10-29 12:00:00'),/12:00 MSK/);
});
test('overflow in derived values is rejected or kept unknown', () => {
  const input = fixture(); input.marketdata.data[0][1] = Number.MAX_VALUE; input.marketdata.data[0][4] = null as never;
  assert.throws(()=>parseMoex(input));
  input.marketdata.data[0][4] = 100; input.marketdata.data[0][2] = null as never; input.securities.data[0][1] = Number.MIN_VALUE;
  assert.equal(parseMoex(input).stocks[0].change,null);
});
