const PROVIDER_PRIORITY = ['Binance public', 'Kraken public', 'Coinbase public'];

function quoteHasFreshProviderTimestamp(quote, quotes, timestampState) {
  const index = quotes.indexOf(quote);
  const timestamp = timestampState?.[index];
  return quote?.live !== false
    && quote?.timestampType === 'PROVIDER_TIMESTAMP'
    && timestamp?.valid === true
    && timestamp?.fresh === true;
}

/**
 * Select the quote whose price, provider and timestamp will be reported together.
 * Prefer the normal provider priority among fresh provider-timestamped quotes.
 * If none qualifies, preserve the configured fallback order so the caller can
 * label the data honestly and let the execution gate fail closed.
 */
export function selectPrimaryMarketQuote(quotes, timestampState) {
  if (!Array.isArray(quotes) || quotes.length === 0) return null;
  const ordered = PROVIDER_PRIORITY
    .map((provider) => quotes.find((quote) => quote?.provider === provider))
    .filter(Boolean);
  const verifiedTimeQuote = ordered.find((quote) =>
    quoteHasFreshProviderTimestamp(quote, quotes, timestampState)
  );
  if (verifiedTimeQuote) return verifiedTimeQuote;
  return ordered[0] || quotes.slice().sort((a, b) =>
    (Number(a?.latencyMs) || Number.POSITIVE_INFINITY)
    - (Number(b?.latencyMs) || Number.POSITIVE_INFINITY)
  )[0] || null;
}
