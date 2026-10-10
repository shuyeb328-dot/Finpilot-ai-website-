import assert from "node:assert/strict";
import {cryptoProviderSymbols, cryptoSymbolIsSupported} from "../server/crypto-provider-symbols.mjs";

assert.deepEqual(cryptoProviderSymbols("BTCUSDT", "BTCUSDT"), {base:"BTC",quote:"USDT",krakenPair:"XBTUSDT",coinbaseProduct:"BTC-USDT",sourceSymbol:"BTCUSDT"});
assert.deepEqual(cryptoProviderSymbols("BTC", "BTCUSDT"), {base:"BTC",quote:"USDT",krakenPair:"XBTUSDT",coinbaseProduct:"BTC-USDT",sourceSymbol:"BTCUSDT"});
assert.deepEqual(cryptoProviderSymbols("ETHUSDT", "ETHUSDT"), {base:"ETH",quote:"USDT",krakenPair:"ETHUSDT",coinbaseProduct:"ETH-USDT",sourceSymbol:"ETHUSDT"});
assert.deepEqual(cryptoProviderSymbols("BTC", "BTCUSD"), {base:"BTC",quote:"USD",krakenPair:"XBTUSD",coinbaseProduct:"BTC-USD",sourceSymbol:"BTCUSD"});
assert.equal(cryptoProviderSymbols("BTC/USDT", "BTCUSDT").coinbaseProduct, "BTC-USDT");
assert.equal(cryptoProviderSymbols("UNKNOWN", "UNKNOWNXYZ"), null);
assert.equal(cryptoSymbolIsSupported("BTCUSDT", "BTCUSDT"), true);
assert.equal(cryptoSymbolIsSupported("UNKNOWN", "UNKNOWNXYZ"), false);

console.log("crypto-provider-symbols: quote currency preserved across provider fallbacks");
