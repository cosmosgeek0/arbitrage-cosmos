import type { BookTicker, Futures24hTicker } from '../binance/rest.js';
import type { SymbolRow } from '../types.js';
import { openInterestToPerpVolumeRatio } from './marketData.js';

export type MarketApiOwnerRow = SymbolRow & {
  readonly hasSpot: boolean;
  readonly hasPerp: boolean;
};

export interface MarketApiProjectionInput {
  readonly row: Readonly<MarketApiOwnerRow>;
  readonly spotBook?: Readonly<BookTicker>;
  readonly perpBook?: Readonly<BookTicker>;
  readonly perpTicker?: Readonly<Futures24hTicker>;
  readonly spark: readonly number[];
}

function usableBook(book: Readonly<BookTicker> | undefined): Readonly<BookTicker> | null {
  if (!book || !(book.bidPrice > 0) || !(book.askPrice > 0) || book.askPrice < book.bidPrice) return null;
  return book;
}

function spreadPct(book: Readonly<BookTicker> | null): number | null {
  if (!book) return null;
  const mid = (book.bidPrice + book.askPrice) / 2;
  return mid > 0 ? ((book.askPrice - book.bidPrice) / mid) * 100 : null;
}

function topQuoteUsd(book: Readonly<BookTicker> | null): number | null {
  if (!book) return null;
  const bidQuote = book.bidPrice * book.bidQty;
  const askQuote = book.askPrice * book.askQty;
  const usable = Math.min(bidQuote, askQuote);
  return Number.isFinite(usable) && usable > 0 ? usable : null;
}

function gapPct(a: number | null, b: number | null, denominator: number | null): number | null {
  if (a === null || b === null || denominator === null || denominator <= 0) return null;
  return ((a - b) / denominator) * 100;
}

/**
 * Complete pure projection for one `/api/markets` row. The route supplies
 * owner rows only; this adapter never re-derives MarketEngine freshness.
 */
export function projectMarketApiRow(input: Readonly<MarketApiProjectionInput>) {
  const { row } = input;
  const spotBook = usableBook(input.spotBook);
  const perpBook = row.hasPerp ? usableBook(input.perpBook) : null;
  const perpTicker = row.hasPerp ? input.perpTicker : undefined;
  const perpVolume24h = perpTicker?.quoteVolume ?? null;
  const executableBasisLongSpotPct = gapPct(
    perpBook?.bidPrice ?? null,
    spotBook?.askPrice ?? null,
    spotBook?.askPrice ?? null,
  );
  const executableBasisShortSpotPct = gapPct(
    spotBook?.bidPrice ?? null,
    perpBook?.askPrice ?? null,
    perpBook?.askPrice ?? null,
  );
  const executableBasisBestPct = executableBasisLongSpotPct === null
    ? executableBasisShortSpotPct
    : executableBasisShortSpotPct === null
      ? executableBasisLongSpotPct
      : Math.max(executableBasisLongSpotPct, executableBasisShortSpotPct);
  const executableBasisSide = executableBasisBestPct === null
    ? null
    : executableBasisBestPct === executableBasisLongSpotPct
      ? ('LONG_SPOT_SHORT_PERP' as const)
      : ('SHORT_SPOT_LONG_PERP' as const);
  return {
    ...row,
    status: 'idle' as const,
    spark: [...input.spark],
    spotBid: spotBook?.bidPrice ?? null,
    spotAsk: spotBook?.askPrice ?? null,
    spotBidQty: spotBook?.bidQty ?? null,
    spotAskQty: spotBook?.askQty ?? null,
    spotSpreadPct: spreadPct(spotBook),
    spotTopQuoteUsd: topQuoteUsd(spotBook),
    perpBid: perpBook?.bidPrice ?? null,
    perpAsk: perpBook?.askPrice ?? null,
    perpBidQty: perpBook?.bidQty ?? null,
    perpAskQty: perpBook?.askQty ?? null,
    perpSpreadPct: spreadPct(perpBook),
    perpTopQuoteUsd: topQuoteUsd(perpBook),
    perpLast: perpTicker?.lastPrice ?? null,
    perpChange24hPct: perpTicker?.priceChangePct ?? null,
    perpVolume24h,
    perpHigh24h: perpTicker?.highPrice ?? null,
    perpLow24h: perpTicker?.lowPrice ?? null,
    oiToPerpVolume24h: openInterestToPerpVolumeRatio(row.openInterestUsd, perpVolume24h),
    executableBasisLongSpotPct,
    executableBasisShortSpotPct,
    executableBasisBestPct,
    executableBasisSide,
    fundingAnnualPct: row.fundingRate === null ? null : row.fundingRate * 3 * 365 * 100,
  };
}
