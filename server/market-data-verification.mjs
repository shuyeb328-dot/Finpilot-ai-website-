const PROVIDER_PRIORITY = {
  CRYPTO: ['Binance public', 'Gate.io public', 'Kraken public', 'Coinbase public'],
  INDIAN_EQUITY: ['NSE India official', 'BSE India official', 'NSE public market data', 'Yahoo Finance', 'TejHQ EOD'],
  INDIAN_INDEX: ['NSE India official', 'BSE India official', 'Yahoo Finance'],
  GLOBAL_EQUITY: ['Official exchange', 'Yahoo Finance', 'Issuer investor relations'],
  GLOBAL_INDEX: ['Official exchange', 'Yahoo Finance'],
  OPTIONS: ['NSE India official', 'BSE India official', 'Broker market data'],
  FUTURES: ['NSE India official', 'BSE India official', 'Broker market data'],
  DEFAULT: ['Official exchange', 'NSE India official', 'BSE India official', 'Yahoo Finance', 'Coinbase public', 'Kraken public', 'Binance public']
};

function quoteHasFreshProviderTimestamp(quote, quotes, timestampState) {
  const index = quotes.indexOf(quote);
  const timestamp = timestampState?.[index];
  return quote?.live === true
    && quote?.timestampType === 'PROVIDER_TIMESTAMP'
    && timestamp?.valid === true
    && timestamp?.fresh === true;
}

/**
 * Choose a source only within the requested asset class. Provider priority is
 * not a claim of availability; quote timestamp and freshness must still pass.
 * The legacy default remains crypto-compatible for existing callers.
 */
export function selectPrimaryMarketQuote(quotes, timestampState, options = {}) {
  if (!Array.isArray(quotes) || quotes.length === 0) return null;
  const assetClass = String(options.assetClass || 'CRYPTO').toUpperCase();
  const priority = PROVIDER_PRIORITY[assetClass] || PROVIDER_PRIORITY.DEFAULT;
  const ordered = priority.map(provider => quotes.find(quote => quote?.provider === provider)).filter(Boolean);
  const verified = ordered.find(quote => quoteHasFreshProviderTimestamp(quote, quotes, timestampState));
  if (verified) return verified;
  return ordered[0] || quotes.slice().sort((a, b) =>
    (Number(a?.latencyMs) || Number.POSITIVE_INFINITY) -
    (Number(b?.latencyMs) || Number.POSITIVE_INFINITY)
  )[0] || null;
}
