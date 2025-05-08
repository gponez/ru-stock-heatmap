import type { EChartsOption, TreemapSeriesOption } from 'echarts';
import { compactMoney, formatChange, formatMetric, formatTimestamp, METRIC_LABELS, money } from './model.ts';
import type { ColorMetric, SizeMetric, Stock } from './model.ts';

export type Grouping = 'sector' | 'none';
export type HeatmapNode = {
  id: string;
  name: string;
  value: number;
  stock?: Stock;
  metric?: ColorMetric;
  selected?: boolean;
  children?: HeatmapNode[];
  itemStyle?: { color: string };
  label?: { color: string };
};
export const CHANGE_COLORS = ['#991f29', '#f23645', '#f77c80', '#c9c9c9', '#42bd7f', '#089950', '#056636'];
function interpolate(from: number[], to: number[], amount: number): string {
  return '#' + from.map((channel, i) => Math.round(channel + (to[i] - channel) * amount).toString(16).padStart(2, '0')).join('');
}
export function stockColor(stock: Stock, metric: ColorMetric, maxTurnover: number): string {
  if (metric === 'turnover') {
    const fraction = maxTurnover > 0 ? Math.max(0, Math.min(1, stock.turnover / maxTurnover)) : 0;
    return interpolate([219, 234, 254], [30, 64, 175], fraction);
  }
  const value = stock[metric];
  if (value == null || !Number.isFinite(value)) return '#9ca3af';
  const index = value <= -2.5 ? 0 : value <= -1.5 ? 1 : value <= -.5 ? 2 : value < .5 ? 3 : value < 1.5 ? 4 : value < 2.5 ? 5 : 6;
  return CHANGE_COLORS[index];
}
export function labelColor(background: string): string {
  const channels = [1, 3, 5].map((start) => parseInt(background.slice(start, start + 2), 16) / 255)
    .map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  const darkContrast = (luminance + .05) / (.0092 + .05);
  const whiteContrast = 1.05 / (luminance + .05);
  return darkContrast >= whiteContrast ? '#111827' : '#ffffff';
}
export function chartData(stocks: Stock[], grouping: Grouping, size: SizeMetric, color: ColorMetric): HeatmapNode[] {
  const maxTurnover = Math.max(0, ...stocks.map((stock) => stock.turnover));
  const leaves: HeatmapNode[] = stocks.filter((stock) => stock[size] > 0).map((stock) => ({
    id: stock.ticker,
    name: stock.ticker,
    value: stock[size],
    stock,
    metric: color,
    itemStyle: { color: stockColor(stock, color, maxTurnover) },
    label: { color: labelColor(stockColor(stock, color, maxTurnover)) },
  }));
  if (grouping === 'none') return leaves;
  const groups = new Map<string, HeatmapNode>();
  for (const leaf of leaves) {
    const sector = leaf.stock!.sector;
    const group = groups.get(sector) ?? { id: `sector:${sector}`, name: sector, value: 0, children: [], itemStyle: { color: '#ffffff' } };
    group.value += leaf.value;
    group.children!.push(leaf);
    groups.set(sector, group);
  }
  return [...groups.values()];
}
function escapeHtml(value: string): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}
export function tooltipHtml(node: HeatmapNode, baseUrl: string): string {
  if (!node.stock) return `<strong>${escapeHtml(node.name)}</strong>`;
  const stock = node.stock;
  return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><img src="${escapeHtml(`${baseUrl}logos/${stock.ticker}.png`)}" alt="" width="28" height="28" style="border-radius:50%;object-fit:contain"><strong>${escapeHtml(stock.ticker)} · ${escapeHtml(stock.name)}</strong></div>` +
    `Sector: ${escapeHtml(stock.sector)}<br>` +
    `Price, ₽: ${money(stock.price)} ₽<br>` +
    `${METRIC_LABELS.change}: ${formatChange(stock.change)}<br>` +
    `${METRIC_LABELS.changeWeek}: ${formatChange(stock.changeWeek)}<br>` +
    `${METRIC_LABELS.marketCap}: ${compactMoney(stock.marketCap)}<br>` +
    `${METRIC_LABELS.turnover}: ${compactMoney(stock.turnover)}<br>` +
    `<span style="color:#6b7280;font-size:11px">${stock.weekReferenceDate ? `1W reference close: ${escapeHtml(stock.weekReferenceDate)}<br>` : ''}Feed time: ${escapeHtml(formatTimestamp(stock.updatedAt))}</span>`;
}
export function chartOption(stocks: Stock[], grouping: Grouping, size: SizeMetric, color: ColorMetric, baseUrl: string, selectedSector: string | null = null): EChartsOption {
  const visibleStocks = selectedSector ? stocks.filter((stock) => stock.sector === selectedSector) : stocks;
  const series: TreemapSeriesOption = {
    id: 'stocks',
    type: 'treemap',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    roam: true,
    nodeClick: false,
    sort: 'desc',
    animation: false,
    breadcrumb: { show: false },
    itemStyle: { borderColor: '#ffffff', borderWidth: 1, gapWidth: 1 },
    label: {
      show: true,
      color: '#ffffff',
      fontFamily: 'Arial',
      fontSize: 16,
      fontWeight: 500,
      overflow: 'truncate',
      ellipsis: '',
      formatter: (params) => {
        const node = params.data as HeatmapNode;
        return node.stock ? `${node.name}\n${formatMetric(node.stock, node.metric ?? 'change')}` : '';
      },
    },
    upperLabel: { show: false },
    levels: grouping === 'sector' ? [
      { itemStyle: { borderWidth: 0, gapWidth: 3 } },
      { itemStyle: { borderColor: '#e5e7eb', borderWidth: 1, gapWidth: 1 }, upperLabel: { show: true, formatter: '{b}', height: 30, color: '#374151', fontFamily: 'Arial', fontSize: 12, lineHeight: 14, overflow: 'break', ellipsis: '', backgroundColor: '#ffffff' } },
      { itemStyle: { borderColor: '#ffffff', borderWidth: 1, gapWidth: 1 }, upperLabel: { show: false } },
    ] : [],
    data: chartData(visibleStocks, grouping, size, color).map((node) => ({ ...node, selected: Boolean(node.children && node.name === selectedSector) })),
  };
  return {
    backgroundColor: '#ffffff',
    textStyle: { fontFamily: 'Arial' },
    aria: { enabled: true, description: `Russian stock heatmap. Tile area: ${METRIC_LABELS[size]}. Tile colour and value: ${METRIC_LABELS[color]}. Click a stock for full-screen details, or a sector heading to select it.` },
    tooltip: {
      backgroundColor: '#ffffff',
      borderColor: '#e5e7eb',
      textStyle: { color: '#374151', fontFamily: 'Arial', fontSize: 13 },
      confine: true,
      formatter: (params) => {
        const item = (Array.isArray(params) ? params[0] : params) as { data?: HeatmapNode };
        return item.data ? tooltipHtml(item.data, baseUrl) : '';
      },
    },
    series: [series],
  };
}
