const SUPPORTED_QUOTES = ["USDT", "USDC", "USD", "EUR"];

function compactSymbol(value) {
  return String(value ?? "").trim().toUpperCase().replace(/[\/_\-\s]/g, "");
}

function parseBaseQuote(value) {
  const symbol = compactSymbol(value);
  for (const quote of SUPPORTED_QUOTES) {
    if (symbol.endsWith(quote) && symbol.length > quote.length) {
      return { base: symbol.slice(0, -quote.length), quote };
    }
  }
  return null;
}

/**
 * Resolve fallback exchange product IDs from the same quote currency as the
 * configured Binance symbol. This prevents mixing a BTC/USDT price with a
 * BTC/USD fallback for the same requested instrument.
 */
export function cryptoProviderSymbols(requestedSymbol, preferredSymbol) {
  const preferred = compactSymbol(preferredSymbol);
  const requested = compactSymbol(requestedSymbol);
  const parsed = parseBaseQuote(preferred) || parseBaseQuote(requested);
  if (!parsed) return null;
  const base = parsed.base;
  const krakenBase = base === "BTC" ? "XBT" : base;
  return {
    base,
    quote: parsed.quote,
    krakenPair: krakenBase + parsed.quote,
    coinbaseProduct: base + "-" + parsed.quote,
    sourceSymbol: preferred || requested
  };
}

export function cryptoSymbolIsSupported(requestedSymbol, preferredSymbol) {
  return cryptoProviderSymbols(requestedSymbol, preferredSymbol) !== null;
}
