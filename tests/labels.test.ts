import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as echarts from 'echarts';
import { chartOption } from '../src/chart.ts';
import { applyAdaptiveLabels } from '../src/labels.ts';
import { parseMoex } from '../src/model.ts';

const saved = JSON.parse(readFileSync(new URL('../src/snapshot.json', import.meta.url), 'utf8'));
const stocks = parseMoex(saved.payload, saved.fetchedAt).stocks;

test('sector selection focuses native tiles and survives label fitting before clearing', () => {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 660, height: 700 });
  try {
    const sector = stocks[0].sector;
    for (const size of ['marketCap', 'turnover'] as const) {
      chart.setOption(chartOption(stocks, 'sector', size, 'change', './', sector), { notMerge: true });
      applyAdaptiveLabels(chart, './');
      const groups = chart.getModel().getSeriesByIndex(0).getData().tree.root.children;
      assert.equal(groups.length, 1);
      const group = groups[0];
      assert.equal(group.name, sector);
      assert.equal(group.getModel().option.upperLabel.backgroundColor, '#111827');
      assert.equal(group.getModel().option.upperLabel.color, '#ffffff');
      assert.deepEqual(group.children.map((node) => node.name).sort(), stocks.filter((stock) => stock.sector === sector && stock[size] > 0).map((stock) => stock.ticker).sort());
      assert.equal(applyAdaptiveLabels(chart, './'), false);
    }
    chart.setOption(chartOption(stocks, 'sector', 'marketCap', 'change', './'), { notMerge: true });
    applyAdaptiveLabels(chart, './');
    const groups = chart.getModel().getSeriesByIndex(0).getData().tree.root.children;
    assert.equal(groups.flatMap((group) => group.children).length, stocks.length);
    assert.ok(groups.every((group) => group.getModel().option.upperLabel.backgroundColor === '#ffffff'));
  } finally { chart.dispose(); }
});

test('native adaptive labels render without ellipses or overflow at mobile and desktop sizes', () => {
  for (const width of [390, 660, 1280]) for (const size of ['marketCap', 'turnover'] as const) for (const grouping of ['sector', 'none'] as const) {
    const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height: 700 });
    try {
      chart.setOption(chartOption(stocks, grouping, size, 'change', '/ru-stock-heatmap/'));
      assert.equal(applyAdaptiveLabels(chart, '/ru-stock-heatmap/'), true);
      assert.equal(applyAdaptiveLabels(chart, '/ru-stock-heatmap/'), false, 'unchanged sizing must settle');
      const svg = chart.renderToSVGString();
      const renderedLines = [...svg.matchAll(/<text[^>]*>(.*?)<\/text>/g)].map((match) => match[1]);
      assert.doesNotMatch(svg, /NaN|Infinity|\.\.\.|…/);
      assert.match(svg, /Arial/);
      const model = chart.getModel().getSeriesByIndex(0);
      model.getData().tree.root.eachNode((node) => {
        const item = node.getModel().option;
        if (item.stock && item.label.show) {
          assert.ok(item.label.formatter.split('\n').includes(item.name), 'shown ticker must be complete');
          assert.ok(renderedLines.includes(item.name), `ticker missing from rendered SVG: ${item.name}`);
          assert.ok(item.label.fontSize >= 11 && item.label.fontSize <= 24);
        }
        if (item.children && item.upperLabel?.show) {
          assert.equal(item.upperLabel.formatter.replaceAll('\n', ' '), item.name);
          for (const line of item.upperLabel.formatter.split('\n')) assert.ok(renderedLines.includes(line), `sector line clipped in rendered SVG: ${line}`);
        }
      });
      chart.getViewOfSeriesModel(model).group.traverse((element) => {
        const text = element.getTextContent();
        if (!text || text.ignore || !text.style.text) return;
        const textBox = text.getBoundingRect().clone(); textBox.applyTransform(text.getComputedTransform());
        const tileBox = element.getBoundingRect().clone(); tileBox.applyTransform(element.getComputedTransform());
        assert.ok(textBox.x >= tileBox.x - 1.5 && textBox.y >= tileBox.y - 1.5 && textBox.x + textBox.width <= tileBox.x + tileBox.width + 1.5 && textBox.y + textBox.height <= tileBox.y + tileBox.height + 1.5, `label outside tile: ${text.style.text}`);
        if (!text.disableLabelLayout) {
          // Exclude transparent full-tile rich-text boxes: they can be centered
          // while the actual logo and text are incorrectly drawn at the top.
          const visible = text.childrenRef().filter((child) => child.type === 'image' || (child.type === 'tspan' && child.style.text?.trim()));
          const boxes = visible.map((child) => { const box = child.getBoundingRect().clone(); box.applyTransform(child.getComputedTransform()); return box; });
          if (boxes.length) {
            const visibleBox = boxes[0].clone(); for (const box of boxes.slice(1)) visibleBox.union(box);
            assert.ok(Math.abs(visibleBox.x + visibleBox.width / 2 - tileBox.x - tileBox.width / 2) <= 2, `visible label is not horizontally centered: ${text.style.text}`);
            assert.ok(Math.abs(visibleBox.y + visibleBox.height / 2 - tileBox.y - tileBox.height / 2) <= 2, `visible label is not vertically centered: ${text.style.text}`);
          }
        }
      });
    } finally { chart.dispose(); }
  }
});

test('native adaptive labels preserve a zoomed and panned treemap rectangle', () => {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 1280, height: 700 });
  try {
    chart.setOption(chartOption(stocks, 'sector', 'marketCap', 'change', './'));
    applyAdaptiveLabels(chart, './');
    const rootRect = { x: -200, y: -100, width: 1920, height: 1050 };
    chart.dispatchAction({ type: 'treemapRender', seriesId: 'stocks', rootRect });
    assert.equal(applyAdaptiveLabels(chart, './'), true);
    const layout = chart.getModel().getSeriesByIndex(0).getData().tree.root.getLayout();
    for (const key of Object.keys(rootRect)) assert.equal(layout[key], rootRect[key]);
    assert.equal(applyAdaptiveLabels(chart, './'), false);
  } finally { chart.dispose(); }
});
