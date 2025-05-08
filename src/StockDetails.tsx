import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { labelColor } from './chart.ts';
import { compactMoney, formatChange, formatTimestamp, METRIC_LABELS, money } from './model.ts';
import type { Stock } from './model.ts';
import './stock-details.css';

const fallbackColor = '#e5e7eb';
const logoColors = new Map<string, string>();

export default function StockDetails({ stock, onClose }: { stock: Stock; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const logoUrl = `${import.meta.env.BASE_URL}logos/${stock.ticker}.png`;
  const [theme, setTheme] = useState({ url: logoUrl, color: logoColors.get(logoUrl) ?? fallbackColor });
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const logoColor = theme.url === logoUrl ? theme.color : logoColors.get(logoUrl) ?? fallbackColor;
  const background = '#' + [1, 3, 5].map((start) => Math.round(parseInt(logoColor.slice(start, start + 2), 16) * 0.78 * 0.7).toString(16).padStart(2, '0')).join('');

  useLayoutEffect(() => {
    const element = dialog.current!;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    document.body.style.overflow = 'hidden';
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    const cached = logoColors.get(logoUrl);
    if (cached) {
      setTheme({ url: logoUrl, color: cached });
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return;
        context.drawImage(image, 0, 0, 32, 32);
        const pixels = context.getImageData(0, 0, 32, 32).data;
        const sums = [0, 0, 0];
        let weight = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const alpha = pixels[i + 3] / 255;
          weight += alpha;
          for (let channel = 0; channel < 3; channel++) sums[channel] += pixels[i + channel] * alpha;
        }
        const color = weight > 0
          ? '#' + sums.map((sum) => Math.round(sum / weight).toString(16).padStart(2, '0')).join('')
          : fallbackColor;
        logoColors.set(logoUrl, color);
        setTheme({ url: logoUrl, color });
      } catch {
        // Keep the neutral background if the image cannot be sampled.
      }
    };
    image.src = logoUrl;
    return () => {
      cancelled = true;
      image.onload = null;
    };
  }, [logoUrl]);

  return <dialog
    ref={dialog}
    className="stock-details"
    aria-labelledby="stock-details-title"
    style={{ backgroundColor: `${background}e0`, color: labelColor(background) }}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
  >
    <button className="stock-details-close" onClick={onClose} autoFocus aria-label="Close stock details">Close <span aria-hidden="true">×</span></button>
    <div className="stock-details-content">
      <div className="stock-details-identity">
        {failedLogo !== logoUrl && <img className="stock-details-logo" src={logoUrl} alt="" width="96" height="96" onError={() => setFailedLogo(logoUrl)} />}
        <div>
          <h2 id="stock-details-title">{stock.ticker}</h2>
          <p className="stock-details-name">{stock.name}</p>
        </div>
      </div>
      <dl className="stock-details-values">
        <div><dt>Price, ₽</dt><dd>{money(stock.price)} ₽</dd></div>
        <div><dt>{METRIC_LABELS.change}</dt><dd>{formatChange(stock.change)}</dd></div>
        <div title={stock.weekReferenceDate ? `Compared with the close on ${stock.weekReferenceDate}` : 'Weekly history unavailable'}><dt>{METRIC_LABELS.changeWeek}</dt><dd>{formatChange(stock.changeWeek)}</dd></div>
        <div><dt>{METRIC_LABELS.marketCap}</dt><dd>{compactMoney(stock.marketCap)}</dd></div>
        <div><dt>{METRIC_LABELS.turnover}</dt><dd>{compactMoney(stock.turnover)}</dd></div>
        <div className="stock-details-sector"><dt>Sector</dt><dd>{stock.sector}</dd></div>
      </dl>
      <p className="stock-details-source">{stock.weekReferenceDate && <>1W reference close: {stock.weekReferenceDate}<br /></>}MOEX ISS · Feed time: {formatTimestamp(stock.updatedAt)}</p>
    </div>
  </dialog>;
}
