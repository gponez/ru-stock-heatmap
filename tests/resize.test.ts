import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as echarts from 'echarts';
import { chartOption } from '../src/chart.ts';
import { applyAdaptiveLabels, resizeHeatmap } from '../src/labels.ts';
import { parseMoex } from '../src/model.ts';

const saved = JSON.parse(readFileSync(new URL('../src/snapshot.json', import.meta.url), 'utf8'));
const stocks = parseMoex(saved.payload, saved.fetchedAt).stocks;
const baseUrl = '/ru-stock-heatmap/';

function rootRect(chart: echarts.ECharts) {
  const layout = chart.getModel().getSeriesByIndex(0).getData().tree.root.getLayout();
  return { x: layout.x, y: layout.y, width: layout.width, height: layout.height };
}

function assertNormalizedView(chart: echarts.ECharts, expected: { x: number; y: number; width: number; height: number }) {
  const actual = rootRect(chart);
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const viewport = key === 'x' || key === 'width' ? chart.getWidth() : chart.getHeight();
    assert.ok(Math.abs(actual[key] / viewport - expected[key]) < 1e-8, `${key} changed during resize: ${actual[key] / viewport} instead of ${expected[key]}`);
  }
}

test('resizing preserves zoom and pan through repeated narrow, wide and tall views', () => {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 1280, height: 700 });
  try {
    chart.setOption(chartOption(stocks, 'sector', 'marketCap', 'change', baseUrl));
    applyAdaptiveLabels(chart, baseUrl);
    chart.dispatchAction({ type: 'treemapRender', seriesId: 'stocks', rootRect: { x: -200, y: -100, width: 1920, height: 1050 } });
    applyAdaptiveLabels(chart, baseUrl);
    const expected = { x: -200 / 1280, y: -100 / 700, width: 1.5, height: 1.5 };

    for (const [width, height] of [[660, 600], [390, 700], [1500, 500], [1280, 700], [660, 600]]) {
      assert.equal(resizeHeatmap(chart, width, height, baseUrl), true);
      assert.equal(chart.getWidth(), width);
      assert.equal(chart.getHeight(), height);
      assertNormalizedView(chart, expected);
      assert.equal(applyAdaptiveLabels(chart, baseUrl), false, 'resize should return with labels already settled');
      assert.doesNotMatch(chart.renderToSVGString(), /NaN|Infinity|\.\.\.|…/);
    }
  } finally { chart.dispose(); }
});

test('resizing a selected sector retains its stocks, heading and fitted labels', () => {
  const sector = 'Финансы';
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 1280, height: 700 });
  try {
    chart.setOption(chartOption(stocks, 'sector', 'marketCap', 'change', baseUrl, sector));
    applyAdaptiveLabels(chart, baseUrl);
    for (const [width, height] of [[390, 700], [660, 600], [1280, 700]]) {
      resizeHeatmap(chart, width, height, baseUrl);
      const groups = chart.getModel().getSeriesByIndex(0).getData().tree.root.children;
      assert.equal(groups.length, 1);
      assert.equal(groups[0].name, sector);
      assert.equal(groups[0].getModel().option.upperLabel.backgroundColor, '#111827');
      assert.deepEqual(groups[0].children.map((node) => node.name).sort(), stocks.filter((stock) => stock.sector === sector).map((stock) => stock.ticker).sort());
      const svg = chart.renderToSVGString();
      assert.match(svg, /Финансы/);
      assert.match(svg, /SBER/);
      assert.doesNotMatch(svg, />LKOH<|>Нефть и газ</);
      assert.equal(applyAdaptiveLabels(chart, baseUrl), false);
    }
  } finally { chart.dispose(); }
});

test('the resize paint contains the restored view and complete labels', () => {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 1280, height: 700 });
  try {
    chart.setOption(chartOption(stocks, 'sector', 'marketCap', 'change', baseUrl));
    applyAdaptiveLabels(chart, baseUrl);
    chart.dispatchAction({ type: 'treemapRender', seriesId: 'stocks', rootRect: { x: -320, y: -175, width: 2560, height: 1400 } });
    applyAdaptiveLabels(chart, baseUrl);
    const renderer = chart.getZr();
    const flush = renderer.flush;
    const paints: { rect: ReturnType<typeof rootRect>; svg: string }[] = [];
    renderer.flush = function () {
      paints.push({ rect: rootRect(chart), svg: chart.renderToSVGString() });
      flush.call(this);
    };
    resizeHeatmap(chart, 660, 600, baseUrl);
    assert.ok(paints.length > 0, 'the restored view must be painted before resize returns');
    const painted = paints.at(-1)!;
    assert.deepEqual(painted.rect, rootRect(chart));
    assert.equal(painted.rect.width / chart.getWidth(), 2);
    assert.equal(painted.rect.height / chart.getHeight(), 2);
    assert.match(painted.svg, /width="660"/);
    assert.match(painted.svg, /height="600"/);
    assert.doesNotMatch(painted.svg, /NaN|Infinity|\.\.\.|…/);
  } finally { chart.dispose(); }
});

test('unchanged, invalid and disposed resize notifications do not reset the view', () => {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 660, height: 600 });
  try {
    chart.setOption(chartOption(stocks, 'none', 'marketCap', 'change', baseUrl));
    applyAdaptiveLabels(chart, baseUrl);
    chart.dispatchAction({ type: 'treemapRender', seriesId: 'stocks', rootRect: { x: -100, y: -50, width: 990, height: 900 } });
    applyAdaptiveLabels(chart, baseUrl);
    const before = rootRect(chart);
    for (const [width, height] of [[660, 600], [660.2, 599.8], [0, 600], [-1, 600], [660, 0], [NaN, 600], [660, Infinity]]) {
      assert.equal(resizeHeatmap(chart, width, height, baseUrl), false);
      assert.deepEqual(rootRect(chart), before);
    }
  } finally { chart.dispose(); }
  assert.equal(resizeHeatmap(chart, 1280, 700, baseUrl), false);
});
