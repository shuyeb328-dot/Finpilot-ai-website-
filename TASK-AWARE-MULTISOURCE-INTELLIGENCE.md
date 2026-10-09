# FinPilot Task-Aware Multi-Source Intelligence

## Purpose
Classify each user query before retrieval and create an asset-specific source plan. The planner is deterministic and does not claim to fetch live data. Market quote eligibility remains the responsibility of the existing market snapshot and execution safety gates.

## Request flow
1. Classify task intent and asset class from the current query.
2. Resolve an explicitly requested ticker or named instrument without substituting an unrelated result.
3. Discover relevant websites and documents through configured web-search providers.
4. Retrieve structured market data from sources appropriate to the asset class.
5. Normalize exchange, ticker, currency, provider timestamp, retrieval time and provenance.
6. Validate freshness, identity, OHLC consistency and cross-source differences.
7. Pass only validated evidence into agent analysis and the scenario engine.
8. Block forecast-dependent sizing when required quote/contract data is missing or invalid.

## Source policy
- Indian listed equities and indices: investigate NSE India and BSE India official endpoints first where accessible and permitted; issuer disclosures provide primary fundamental evidence.
- US equities: issuer investor-relations pages and SEC EDGAR are primary-document sources; neither is automatically a real-time quote feed.
- Crypto: Binance, Kraken and Coinbase are alternative exchange-specific sources. Pair, quote currency and provider timestamps must match before comparing prices.
- Options/futures: require exact contract, expiry, strike, lot size, underlying and contract quote; a headline or underlying spot quote alone is insufficient.
- News/search: Google News RSS and configured web search are discovery/evidence sources, never authoritative live quote sources.
- Aggregator pages and EOD feeds must be labelled delayed/historical unless their provider timestamps and product terms prove otherwise.

## ₹0 operating constraints
Use public/free access only where terms allow it. Do not bypass authentication, rate limits, anti-bot controls or provider terms. Cache responses within their allowed use, deduplicate requests and respect provider cooldowns. A free endpoint is not automatically real-time or licensed for every use.

## Status fields
liveStatus NOT_FETCHED means the plan has not fetched data. It must not be rendered as a live quote. forecastPolicy REQUIRE_VALIDATED_MARKET_DATA means the existing verification gate must pass before quote-dependent outputs can be approved.

## Test
Run node tests/task-intelligence.test.mjs. Tests use fixed sample queries and do not call external services.
