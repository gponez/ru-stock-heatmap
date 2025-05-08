import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { ECharts } from 'echarts';
import { applyAdaptiveLabels, resizeHeatmap } from './labels';
import { chartOption, CHANGE_COLORS, labelColor } from './chart';
import type { Grouping, HeatmapNode } from './chart';
import StockDetails from './StockDetails';
import { formatTimestamp, METRIC_LABELS, MOEX_URL, parseMoex } from './model';
import { createWeeklyHistory } from './history';
import type { ColorMetric, SizeMetric, Snapshot, Stock } from './model';
import saved from './snapshot.json';
import weeklySaved from './weekly-snapshot.json';

const weeklyHistory = createWeeklyHistory(weeklySaved);
const bundled = weeklyHistory.withCachedWeekly(parseMoex(saved.payload, saved.fetchedAt));

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>(bundled);
  const [source, setSource] = useState<'snapshot' | 'moex'>('snapshot');
  const [loading, setLoading] = useState(false);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [grouping, setGrouping] = useState<Grouping>('sector');
  const [color, setColor] = useState<ColorMetric>('change');
  const [size, setSize] = useState<SizeMetric>('marketCap');
  const [chartKey, setChartKey] = useState(0);
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const request = useRef<AbortController | null>(null);
  const labelFrame = useRef(0);
  const stopResize = useRef<(() => void) | null>(null);
  const chartRef = useRef<InstanceType<typeof ReactECharts> | null>(null);
  const fitLabels = useCallback((chart: ECharts) => {
    window.cancelAnimationFrame(labelFrame.current);
    labelFrame.current = window.requestAnimationFrame(() => {
      if (!chart.isDisposed()) applyAdaptiveLabels(chart, import.meta.env.BASE_URL);
    });
  }, []);
  const chartReady = useCallback((chart: ECharts) => {
    stopResize.current?.();
    applyAdaptiveLabels(chart, import.meta.env.BASE_URL);
    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (chart.isDisposed()) return;
        const { width, height } = chart.getDom().getBoundingClientRect();
        resizeHeatmap(chart, width, height, import.meta.env.BASE_URL);
      });
    });
    observer.observe(chart.getDom());
    stopResize.current = () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, []);
  const chartEvents = useMemo(() => ({
    finished: (_event: unknown, chart: ECharts) => fitLabels(chart),
    click: (event: { data?: HeatmapNode }, chart: ECharts) => {
      const node = event.data;
      if (!node) return;
      chart.dispatchAction({ type: 'hideTip' });
      if (node.stock) setSelectedStock(node.stock);
      else if (node.children) setSelectedSector((current) => current === node.name ? null : node.name);
    },
  }), [fitLabels]);
  useEffect(() => () => {
    window.cancelAnimationFrame(labelFrame.current);
    stopResize.current?.();
  }, []);

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setWeeklyLoading(false);
    const timeout = window.setTimeout(() => controller.abort('timeout'), 12000);
    let next: Snapshot | null = null;
    try {
      const response = await fetch(MOEX_URL, { signal: controller.signal, credentials: 'omit' });
      if (!response.ok) throw new Error(`MOEX HTTP ${response.status}`);
      next = weeklyHistory.withCachedWeekly(parseMoex(await response.json()));
      if (request.current !== controller) return;
      setSnapshot(next);
      setSource('moex');
      setFailed(false);
    } catch {
      if (request.current !== controller) return;
      setFailed(true);
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) setLoading(false);
    }
    if (!next || request.current !== controller || controller.signal.aborted) return;
    setWeeklyLoading(true);
    const historyTimeout = window.setTimeout(() => controller.abort('history timeout'), 30000);
    try {
      const enriched = await weeklyHistory.loadWeeklyHistory(next, controller.signal);
      if (request.current === controller && enriched.stocks.some((stock, index) => stock.changeWeek !== next!.stocks[index]?.changeWeek || stock.weekReferenceDate !== next!.stocks[index]?.weekReferenceDate)) setSnapshot(enriched);
    } catch {
      // A history failure must not discard the latest quotes or daily turnover.
    } finally {
      window.clearTimeout(historyTimeout);
      if (request.current === controller) setWeeklyLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
    return () => {
      window.clearInterval(timer);
      request.current?.abort();
      request.current = null;
    };
  }, [refresh]);

  const option = useMemo(() => chartOption(snapshot.stocks, grouping, size, color, import.meta.env.BASE_URL, selectedSector), [snapshot, grouping, size, color, selectedSector]);
  useEffect(() => {
    const chart = chartRef.current?.getEchartsInstance();
    if (chart) fitLabels(chart);
  }, [option, chartKey, fitLabels]);
  const timestamp = snapshot.stocks.map((stock) => stock.updatedAt).sort().at(-1) || snapshot.fetchedAt;
  const visibleStocks = selectedSector ? snapshot.stocks.filter((stock) => stock.sector === selectedSector) : snapshot.stocks;
  const hidden = size === 'turnover' ? visibleStocks.filter((stock) => stock.turnover === 0).length : 0;
  const missingWeekly = color === 'changeWeek' ? visibleStocks.filter((stock) => stock.changeWeek == null).length : 0;
  const empty = hidden === visibleStocks.length;
  const detailStock = selectedStock ? snapshot.stocks.find((stock) => stock.ticker === selectedStock.ticker) ?? selectedStock : null;

  return <div className="app">
    <header>
      <div className="header-content">
        <h1>Stock Heatmap</h1>
        <div className="controls">
          <label>Group
            <select value={grouping} onChange={(event) => { setGrouping(event.target.value as Grouping); setSelectedSector(null); }}>
              <option value="sector">Sector</option>
              <option value="none">None</option>
            </select>
          </label>
          <label>Colour
            <select value={color} onChange={(event) => setColor(event.target.value as ColorMetric)}>
              <option value="change">{METRIC_LABELS.change}</option>
              <option value="changeWeek">{METRIC_LABELS.changeWeek}</option>
              <option value="turnover">{METRIC_LABELS.turnover}</option>
            </select>
          </label>
          <label>Size
            <select value={size} onChange={(event) => setSize(event.target.value as SizeMetric)}>
              <option value="marketCap">{METRIC_LABELS.marketCap}</option>
              <option value="turnover">{METRIC_LABELS.turnover}</option>
            </select>
          </label>
          <button onClick={() => void refresh()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
          {selectedSector && <button onClick={() => setSelectedSector(null)}>← All sectors</button>}
          <button onClick={() => { setSelectedSector(null); setChartKey((key) => key + 1); }}>Reset view</button>
        </div>
      </div>
    </header>
    <main>
      <div className="chart-container">
        {empty ? <p className="empty">No turnover for this trading day. Select {METRIC_LABELS.marketCap}.</p> : <ReactECharts ref={chartRef} key={chartKey} option={option} style={{ height: '100%', width: '100%' }} opts={{ renderer: 'svg' }} onChartReady={chartReady} onEvents={chartEvents} autoResize={false} notMerge />}
      </div>
      <div className="legend" aria-label={`${METRIC_LABELS[color]}: ${color === 'turnover' ? 'low to high' : 'percentage bands; outer colours include values beyond minus 3 and plus 3 percent'}`}>
        {color === 'turnover' && <span>Low</span>}
        <div className={`legend-scale ${color === 'turnover' ? 'turnover-gradient' : ''}`}>
          {color !== 'turnover' && CHANGE_COLORS.map((fill, index) => <i key={fill} style={{ background: fill, color: labelColor(fill) }} title={['−2.5% or lower', '−2.5% to −1.5%', '−1.5% to −0.5%', '−0.5% to +0.5%', '+0.5% to +1.5%', '+1.5% to +2.5%', '+2.5% or higher'][index]}>{index > 3 ? '+' : ''}{index - 3}%</i>)}
        </div>
        {color === 'turnover' && <span>High</span>}
      </div>
      <p className="status" role="status">
        {failed ? 'Last available data' : source === 'snapshot' ? 'Saved snapshot' : 'MOEX ISS · delayed quotes'} · Feed time: {formatTimestamp(timestamp)}
        {failed ? ' · MOEX unavailable.' : loading ? ' · Refreshing…' : ''}
        {missingWeekly > 0 ? weeklyLoading ? ' · Loading weekly history…' : ` · Weekly history unavailable for ${missingWeekly} stocks (—).` : ''}
        {hidden > 0 ? ` · ${hidden} stocks with no Turnover 1D hidden.` : ''}
      </p>
    </main>
    {detailStock && <StockDetails stock={detailStock} onClose={() => setSelectedStock(null)} />}
  </div>;
}
