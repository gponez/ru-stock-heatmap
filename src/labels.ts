import { format } from 'echarts';
import type { ECharts } from 'echarts';
import type { HeatmapNode } from './chart.ts';
import { formatMetric } from './model.ts';

type Layout = { x?: number; y?: number; width: number; height: number; borderWidth?: number };
type Node = Omit<HeatmapNode, 'label' | 'children'> & { label?: Record<string, unknown>; upperLabel?: Record<string, unknown>; children?: Node[] };
type NativeNode = { getId(): string; getLayout(): Layout | undefined; eachNode(callback: (node: NativeNode) => void): void };
type NativeSeries = { getData(): { tree: { root: NativeNode } } };
type RichText = { style: { text?: string; lineHeight?: number; width?: number; height?: number; rich?: { logo?: { lineHeight?: number } } }; beforeUpdate: () => void; setStyle(style: { width: number; height: number }): void };
type NativeChart = { getModel(): { getSeriesByIndex(index: number): NativeSeries }; getViewOfSeriesModel(series: NativeSeries): { group: { traverse(callback: (element: { shape?: Layout; getTextContent(): RichText | undefined }) => void): void } } };
const widthOf = (text: string, size: number, weight = 400) => format.getTextRect(text, `${weight} ${size}px Arial`).width;
const nativeRoot = (chart: ECharts) => (chart as unknown as NativeChart).getModel().getSeriesByIndex(0)?.getData().tree.root;

function nativeLayouts(chart: ECharts): Map<string, Layout> {
  const layouts = new Map<string, Layout>();
  const root = nativeRoot(chart);
  root?.eachNode((node) => { const layout = node.getLayout(); if (layout) layouts.set(node.getId(), layout); });
  return layouts;
}

function currentData(chart: ECharts): Node[] {
  const series = chart.getOption().series as { data?: Node[] }[] | undefined;
  return series?.[0]?.data ?? [];
}

function sectorLabel(name: string, layout: Layout, selected = false): Record<string, unknown> {
  const width = layout.width - 12;
  // Wrap with measured whole words here. zrender's automatic break mode estimates
  // Cyrillic character widths and can rewrap a word that actually fits in Arial.
  const base = { fontFamily: 'Arial', fontSize: 12, lineHeight: 15, padding: [0, 4], overflow: 'truncate', ellipsis: '', color: selected ? '#ffffff' : '#374151', backgroundColor: selected ? '#111827' : '#ffffff' };
  if (layout.height < 60 || width <= 0) return { ...base, show: false, height: 0, formatter: '' };
  const lines: string[] = [];
  for (const word of name.split(' ')) {
    if (widthOf(word, 12) > width) return { ...base, show: false, height: 0, formatter: '' };
    const last = lines.length - 1;
    if (last >= 0 && widthOf(`${lines[last]} ${word}`, 12) <= width) lines[last] += ` ${word}`;
    else lines.push(word);
  }
  if (lines.length > 2) return { ...base, show: false, height: 0, formatter: '' };
  return { ...base, show: true, height: lines.length * 15 + 4, formatter: lines.join('\n') };
}

function targetSize(width: number, height: number): number {
  if (width >= 128 && height >= 192) return 24;
  if (width >= 128 && height >= 160) return 20;
  if (width >= 96 && height >= 128) return 18;
  if (width >= 64 && height >= 96) return 14;
  if (width >= 40 && height >= 48) return 12;
  return 11;
}

function leafLabel(node: Node, layout: Layout, baseUrl: string): Record<string, unknown> {
  const width = Math.max(0, layout.width - 10);
  const height = Math.max(0, layout.height - 8);
  const base = { color: node.label?.color, fontFamily: 'Arial', fontWeight: 600, position: 'inside', align: 'center', verticalAlign: 'middle', padding: 0, overflow: 'truncate', ellipsis: '' };
  let size = targetSize(width, height);
  while (size >= 11 && widthOf(node.name, size, 600) > width) size--;
  if (size < 11 || height < size + 4) return { ...base, show: false, formatter: '', fontSize: 11, lineHeight: 15, rich: null, offset: [0, 0] };
  const change = formatMetric(node.stock!, node.metric ?? 'change');
  const changeFits = height >= (size + 4) * 2 && widthOf(change, size, 600) <= width;
  const logoSize = size >= 24 ? 48 : size >= 20 ? 40 : 32;
  const logoFits = width >= 120 && height >= 125 && changeFits && height >= logoSize + (size + 4) * 2 + 8;
  return {
    ...base, show: true, fontSize: size, lineHeight: size + 4,
    offset: [0, 0],
    formatter: `${logoFits ? '{logo| }\n' : ''}${node.name}${changeFits ? `\n${change}` : ''}`,
    rich: logoFits ? { logo: { width: logoSize, height: logoSize, lineHeight: logoSize + 8, align: 'center', borderRadius: logoSize / 2, backgroundColor: { image: `${baseUrl}logos/${node.stock!.ticker}.png` } } } : null,
  };
}

function centerRichLabels(chart: ECharts): boolean {
  const native = chart as unknown as NativeChart;
  const series = native.getModel().getSeriesByIndex(0);
  let changed = false;
  native.getViewOfSeriesModel(series).group.traverse((element) => {
    const text = element.getTextContent();
    if (!text?.style.rich?.logo || !element.shape) return;
    // Treemap's default hook forces the rich box to the whole tile, which places
    // its contents at the top. Keep native width but give the box its true height.
    // Replace the hook instead of calling it then undoing it on every frame.
    text.beforeUpdate = () => {
      const width = Math.max(0, element.shape!.width);
      const height = (text.style.text ?? '').split('\n').reduce((sum, line) => sum + (line.includes('{logo|') ? text.style.rich!.logo!.lineHeight ?? 0 : text.style.lineHeight ?? 0), 0);
      if (text.style.width !== width || text.style.height !== height) {
        text.setStyle({ width, height });
        changed = true;
      }
    };
    text.beforeUpdate();
  });
  return changed;
}

/** Uses ECharts' own tile rectangles; no replacement treemap or geometry. Call after render/resize. */
export function applyAdaptiveLabels(chart: ECharts, baseUrl: string): boolean {
  if (chart.isDisposed()) return false;
  let changed = false;
  // Header height changes child rectangles, so size leaves only after headers settle.
  for (const stage of ['sectors', 'leaves'] as const) {
    const layouts = nativeLayouts(chart);
    const data = currentData(chart);
    const visit = (node: Node): Node => {
      const layout = layouts.get(node.id);
      const next = { ...node, ...(node.children ? { children: node.children.map(visit) } : {}) };
      if (!layout || !Number.isFinite(layout.width) || !Number.isFinite(layout.height)) return next;
      if (stage === 'sectors' && node.children) next.upperLabel = sectorLabel(node.name, layout, node.selected);
      if (stage === 'leaves' && node.stock) next.label = leafLabel(node, layout, baseUrl);
      return next;
    };
    const next = data.map(visit);
    if (JSON.stringify(next) !== JSON.stringify(data)) {
      const root = nativeRoot(chart)?.getLayout();
      const rootRect = root ? { x: root.x ?? 0, y: root.y ?? 0, width: root.width, height: root.height } : null;
      chart.setOption({ series: [{ id: 'stocks', data: next }] }, { lazyUpdate: false, silent: true });
      const after = nativeRoot(chart)?.getLayout();
      // A data-option update resets roam. Restore the exact rectangle ECharts measured.
      if (rootRect && after && (after.x !== rootRect.x || after.y !== rootRect.y || after.width !== rootRect.width || after.height !== rootRect.height)) {
        chart.dispatchAction({ type: 'treemapRender', seriesId: 'stocks', rootRect }, { silent: true });
      }
      changed = true;
    }
  }
  changed = centerRichLabels(chart) || changed;
  // setOption flushes immediately, but the restoring treemap action normally
  // waits for another frame. Paint the final view before returning to the browser.
  if (changed) chart.getZr().flush();
  return changed;
}

/** Resize and restore the normalized zoom/pan in the same browser frame. */
export function resizeHeatmap(chart: ECharts, width: number, height: number, baseUrl: string): boolean {
  width = Math.round(width);
  height = Math.round(height);
  if (chart.isDisposed() || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  const previousWidth = chart.getWidth();
  const previousHeight = chart.getHeight();
  if (width === previousWidth && height === previousHeight) return false;
  const root = nativeRoot(chart)?.getLayout();
  const rootRect = root && previousWidth > 0 && previousHeight > 0 ? {
    x: (root.x ?? 0) * width / previousWidth,
    y: (root.y ?? 0) * height / previousHeight,
    width: root.width * width / previousWidth,
    height: root.height * height / previousHeight,
  } : null;
  chart.resize({ width, height, silent: true, animation: { duration: 0 } });
  if (rootRect) chart.dispatchAction({ type: 'treemapRender', seriesId: 'stocks', rootRect }, { silent: true, flush: false });
  applyAdaptiveLabels(chart, baseUrl);
  chart.getZr().flush();
  return true;
}
