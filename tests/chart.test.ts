import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as echarts from 'echarts';
import type { TreemapSeriesOption } from 'echarts';
import { chartData, chartOption, stockColor, tooltipHtml, labelColor } from '../src/chart.ts';
import { applyAdaptiveLabels } from '../src/labels.ts';
import { parseMoex } from '../src/model.ts';
const saved = JSON.parse(readFileSync(new URL('../src/snapshot.json', import.meta.url), 'utf8'));
const stocks = parseMoex(saved.payload).stocks;

test('flat treemap size uses the selected numeric metric', () => {
  for (const size of ['marketCap','turnover'] as const) {
    const data = chartData(stocks,'none',size,'change');
    assert.equal(data.length,stocks.filter(stock => stock[size] > 0).length);
    for (const node of data) assert.equal(node.value,node.stock![size]);
  }
});
test('sector grouping preserves each stock and the sum of its selected sizes', () => {
  const groups = chartData(stocks,'sector','turnover','change');
  const leaves = groups.flatMap(group=>group.children!);
  assert.equal(new Set(leaves.map(node=>node.id)).size,leaves.length);
  assert.equal(leaves.length,stocks.filter(stock=>stock.turnover>0).length);
  for (const group of groups) {
    assert.equal(group.value,group.children!.reduce((sum,node)=>sum+node.value,0));
    assert.ok(group.children!.every(node=>node.stock!.sector===group.name));
  }
});
test('zero turnover disappears only when size is turnover', () => {
  const zero = {...stocks[0],turnover:0};
  assert.deepEqual(chartData([zero],'sector','turnover','change'),[]);
  assert.equal(chartData([zero],'none','marketCap','turnover').length,1);
  assert.equal(stockColor(zero,'turnover',0),'#dbeafe');
});
test('daily colors use explicit -3/0/+3 bins and clamp outliers', () => {
  for (const [change,color] of [[-3,'#991f29'],[0,'#c9c9c9'],[3,'#056636'],[-100,'#991f29'],[100,'#056636'],[null,'#9ca3af'],[-2.5,'#991f29'],[2.5,'#056636'],[-.49,'#c9c9c9'],[.49,'#c9c9c9']] as const) {
    assert.equal(stockColor({...stocks[0],change},'change',1),color);
  }
});
test('turnover colors use turnover, independent of price change', () => {
  assert.equal(stockColor({...stocks[0],turnover:100,change:-4},'turnover',100),'#1e40af');
  assert.equal(stockColor({...stocks[0],turnover:100,change:4},'turnover',100),'#1e40af');
});
test('tooltip resolves local logos under the Pages path and escapes provider text', () => {
  const node = chartData([{...stocks[0],name:'<script>alert(1)</script>',change:null}],'none','marketCap','change')[0];
  const html = tooltipHtml(node,'/ru-stock-heatmap/');
  assert.ok(html.includes(`/ru-stock-heatmap/logos/${node.name}.png`));
  assert.ok(html.includes('Change 1D, %: —'));
  assert.ok(html.includes(`Sector: ${node.stock!.sector}`));
  assert.ok(!html.includes('<script>'));
});
test('ECharts options retain treemap interaction and Arial without value visualMap', () => {
  const option=chartOption(stocks,'sector','marketCap','change','./');
  const series=(option.series as TreemapSeriesOption[])[0];
  assert.equal(series.type,'treemap');
  assert.equal(series.roam,true);
  assert.equal(series.nodeClick,false);
  assert.equal(series.label?.fontFamily,'Arial');
  assert.equal(option.textStyle?.fontFamily,'Arial');
  assert.equal(option.visualMap,undefined);
});
test('real ECharts SVG renderer renders stock labels with Arial', () => {
  const chart=echarts.init(null,undefined,{renderer:'svg',ssr:true,width:1400,height:900});
  try {
    const option=chartOption(stocks,'none','marketCap','change','./');
    chart.setOption({...option,aria:{enabled:false}});
    const svg=chart.renderToSVGString();
    assert.match(svg,/Arial/);
    assert.match(svg,/SBER/);
    assert.match(svg,/GAZP/);
    assert.match(svg,/LKOH/);
    assert.equal(chart.getModel().getSeriesCount(),1);
  } finally { chart.dispose(); }
});

test('grouped ECharts chart shows sector names instead of blank header strips', () => {
  const chart=echarts.init(null,undefined,{renderer:'svg',ssr:true,width:1400,height:900});
  try {
    chart.setOption({...chartOption(stocks,'sector','marketCap','change','./'),aria:{enabled:false}});
    const svg=chart.renderToSVGString();
    assert.match(svg,/Финансы/);
    assert.match(svg,/Нефть и газ/);
  } finally { chart.dispose(); }
});

test('labels remain readable on original neutral, red and green fills', () => {
  assert.equal(labelColor('#d4d4d8'),'#111827');
  assert.equal(labelColor('#dc2626'),'#ffffff');
  assert.equal(labelColor('#16a34a'),'#111827');
  assert.equal(labelColor('#dbeafe'),'#111827');
  assert.equal(labelColor('#1e40af'),'#ffffff');
});

test('small sector backgrounds stay neutral instead of using the ECharts palette', () => {
  const chart=echarts.init(null,undefined,{renderer:'svg',ssr:true,width:1150,height:558});
  try {
    chart.setOption({...chartOption(stocks,'sector','marketCap','change','./'),aria:{enabled:false}});
    const root=chart.getModel().getSeries()[0].getData().tree.root;
    for (const group of root.children) assert.equal(group.getVisual('style').fill,'#ffffff');
    assert.equal(root.getLayout().width,1150);
    assert.equal(root.getLayout().height,558);
  } finally { chart.dispose(); }
});

test('switching between daily and weekly change updates both rendered colours and adaptive tile values', () => {
  const chart = echarts.init(null, undefined, { renderer: 'svg', ssr: true, width: 600, height: 400 });
  const stock = { ...stocks[0], change: 1.25, changeWeek: -4.25 };
  try {
    for (const [metric, value, fill, previous] of [
      ['changeWeek', '-4,25%', '#991f29', '+1,25%'],
      ['change', '+1,25%', '#42bd7f', '-4,25%'],
    ] as const) {
      chart.setOption({ ...chartOption([stock], 'none', 'marketCap', metric, './'), aria: { enabled: false } }, { notMerge: true });
      assert.ok(chart.renderToSVGString().includes(value), 'initial renderer must use the selected metric');
      applyAdaptiveLabels(chart, './');
      const leaf = chart.getModel().getSeriesByIndex(0).getData().tree.root.children[0];
      assert.equal(leaf.getVisual('style').fill, fill);
      assert.ok(leaf.getModel().option.label.formatter.endsWith(`\n${value}`));
      const svg = chart.renderToSVGString();
      assert.ok(svg.includes(value), 'adaptive labels must retain the selected metric');
      assert.ok(!svg.includes(previous), 'the old metric must not survive the selection change');
    }
  } finally { chart.dispose(); }
});

test('missing weekly history renders a grey dash, distinct from a known zero weekly return', () => {
  const chart = echarts.init(null, undefined, { renderer: 'svg', ssr: true, width: 900, height: 500 });
  const sample = [
    { ...stocks[0], ticker: 'MISSING', change: 4, changeWeek: undefined },
    { ...stocks[0], ticker: 'UNKNOWN', change: 4, changeWeek: null },
    { ...stocks[0], ticker: 'FLAT', change: 4, changeWeek: 0 },
  ];
  try {
    chart.setOption({ ...chartOption(sample, 'none', 'marketCap', 'changeWeek', './'), aria: { enabled: false } });
    applyAdaptiveLabels(chart, './');
    const leaves = chart.getModel().getSeriesByIndex(0).getData().tree.root.children;
    for (const leaf of leaves) {
      const unknown = leaf.name !== 'FLAT';
      assert.equal(leaf.getVisual('style').fill, unknown ? '#9ca3af' : '#c9c9c9');
      assert.ok(leaf.getModel().option.label.formatter.endsWith(unknown ? '\n—' : '\n0,00%'));
    }
    const svg = chart.renderToSVGString();
    assert.equal((svg.match(/>—<\/text>/g) ?? []).length, 2);
    assert.equal((svg.match(/>0,00%<\/text>/g) ?? []).length, 1);
    assert.ok(!svg.includes('+4,00%'));
  } finally { chart.dispose(); }
});
