# RU Stock Heatmap

Interactive heatmap of 26 Russian equities on MOEX TQBR. React + ECharts. No backend or API key.

## Run

Node.js 24 and pnpm 11.25.0.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
pnpm preview
```

## Demo

- Group by sector or show all stocks together.
- Click a ticker for full-screen details; **Close** or **Esc** returns. Click a sector heading to focus it; **All sectors** clears the selection.
- Size by **Market cap, ₽** or **Turnover 1D, ₽**. Colour and tile values follow **Change 1D, %**, **Change 1W, %**, or **Turnover 1D, ₽**.
- Pan/zoom; **Reset view** restores it. Percentage colours use fixed bands labelled −3% to +3%; larger changes share the outer colours.

Sectors are manually assigned. This selection is not an index or the full market. Zero-turnover stocks are hidden only when sized by turnover; stocks without a last price are omitted.

## Data

- **Change 1D:** latest price versus the previous trading day's last price.
- **Change 1W:** latest price versus the closing price seven calendar days before the displayed feed date (MSK). If unavailable on that date, use the nearest earlier close within 30 days. The reference date appears in stock details; missing history shows **—**.
- **Turnover 1D:** accumulated traded value for the trading day on TQBR, in rubles; not a rolling 24 hours.

Delayed MOEX quotes refresh every 60 seconds while the tab is visible. After trading stops, the app continues showing the available prices and turnover. Empty or failed quote responses retain the last successful data; a fresh load starts with a dated **29 October 2026** snapshot, including weekly references. The timestamp is MOEX feed time, not the last trade time. There is no market-open/closed indicator.

## Sources

[MOEX ISS](https://www.moex.com/a8531) supplies market data. Third-party data and trademarks retain their owners' rights.

Logos: [T-Bank Investments](https://www.tbank.ru/invest/stocks/). Exact source URLs, retrieval dates and hashes: [public/logos/sources.json](public/logos/sources.json).
