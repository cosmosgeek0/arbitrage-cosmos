function sourceTime(record) {
  return record.truth.temporal.sourceTransactionTimeMs
    ?? record.truth.temporal.sourceEventTimeMs
    ?? record.truth.temporal.receivedTimeMs;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Test-only proof of the future seam into the existing engines. It maps richer
 * evidence to their current read inputs and deliberately has no decision,
 * proposal, intent, or execution method.
 */
export function adaptEvidenceForExistingEngines({ symbol, evidence, thesis, forensics }) {
  const trades = evidence
    .filter((entry) => entry.kind === 'TRADE' && entry.instrument.productFamily === 'SPOT')
    .map((entry) => ({
      symbol,
      price: entry.price,
      qty: entry.baseQuantity,
      quoteQty: entry.quoteQuantity,
      isBuyerMaker: entry.aggressorSide === 'SELL',
      ts: sourceTime(entry),
    }));
  const books = evidence
    .filter((entry) => entry.kind === 'BOOK_TICKER')
    .map((entry) => ({
      productFamily: entry.instrument.productFamily,
      value: {
        symbol,
        bid: entry.bidPrice,
        ask: entry.askPrice,
        bidQty: entry.bidQuantity,
        askQty: entry.askQuantity,
        ts: sourceTime(entry),
      },
    }));
  const mark = evidence.find((entry) => entry.kind === 'MARK_PRICE');
  const funding = evidence.find((entry) => entry.kind === 'FUNDING');
  const borrow = evidence.find((entry) => entry.kind === 'BORROW');
  return deepFreeze({
    authority: 'EVIDENCE_ONLY',
    symbol,
    volumeSpikeInput: {
      trades,
      spotBook: books.find((entry) => entry.productFamily === 'SPOT')?.value ?? null,
      intelligence: {
        thesisId: thesis.id,
        hypothesis: thesis.hypothesis,
        stage: thesis.stage,
        forensicsState: forensics.tradeability.state,
      },
    },
    basisInput: {
      spotBook: books.find((entry) => entry.productFamily === 'SPOT')?.value ?? null,
      perpetualBook: books.find((entry) => entry.productFamily === 'USD_M_PERPETUAL')?.value ?? null,
      markFunding: mark ? {
        symbol,
        markPrice: mark.markPrice,
        fundingRate: funding?.fundingRate ?? null,
        nextFundingTs: funding?.nextFundingTimeMs ?? null,
        ts: sourceTime(mark),
      } : null,
      borrow: borrow ? {
        asset: borrow.asset,
        eligibility: borrow.eligibility,
        availability: borrow.availability,
        amount: borrow.systemAvailableAmount,
        hourlyInterestRateDecimal: borrow.hourlyInterestRateDecimal,
        evidenceAgeMs: borrow.truth.freshness.ageMs,
      } : null,
      intelligence: {
        thesisId: thesis.id,
        tradeability: thesis.tradeability.state,
      },
    },
    createsProposal: false,
    createsIntent: false,
    executesAction: false,
  });
}
