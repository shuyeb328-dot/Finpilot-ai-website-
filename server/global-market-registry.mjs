export const GLOBAL_INDEXES = [
 {region:'North America',country:'United States',name:'S&P 500',symbol:'^GSPC',type:'index'},
 {region:'North America',country:'United States',name:'Dow Jones Industrial Average',symbol:'^DJI',type:'index'},
 {region:'North America',country:'United States',name:'Nasdaq Composite',symbol:'^IXIC',type:'index'},
 {region:'North America',country:'United States',name:'Russell 2000',symbol:'^RUT',type:'index'},
 {region:'North America',country:'United States',name:'CBOE Volatility Index',symbol:'^VIX',type:'index'},
 {region:'North America',country:'Canada',name:'S&P/TSX Composite',symbol:'^GSPTSE',type:'index'},
 {region:'North America',country:'Mexico',name:'S&P/BMV IPC',symbol:'^MXX',type:'index'},
 {region:'South America',country:'Brazil',name:'Bovespa',symbol:'^BVSP',type:'index'},
 {region:'South America',country:'Argentina',name:'MERVAL',symbol:'^MERV',type:'index'},
 {region:'South America',country:'Chile',name:'IPSA',symbol:'^SP_IPSA',type:'index'},
 {region:'Europe',country:'United Kingdom',name:'FTSE 100',symbol:'^FTSE',type:'index'},
 {region:'Europe',country:'Germany',name:'DAX',symbol:'^GDAXI',type:'index'},
 {region:'Europe',country:'France',name:'CAC 40',symbol:'^FCHI',type:'index'},
 {region:'Europe',country:'Eurozone',name:'Euro Stoxx 50',symbol:'^STOXX50E',type:'index'},
 {region:'Europe',country:'Netherlands',name:'AEX',symbol:'^AEX',type:'index'},
 {region:'Europe',country:'Spain',name:'IBEX 35',symbol:'^IBEX',type:'index'},
 {region:'Europe',country:'Switzerland',name:'SMI',symbol:'^SSMI',type:'index'},
 {region:'Europe',country:'Italy',name:'FTSE MIB',symbol:'FTSEMIB.MI',type:'index'},
 {region:'Europe',country:'Belgium',name:'BEL 20',symbol:'^BFX',type:'index'},
 {region:'Europe',country:'Portugal',name:'PSI',symbol:'^PSI20',type:'index'},
 {region:'Europe',country:'Sweden',name:'OMX Stockholm 30',symbol:'^OMX',type:'index'},
 {region:'Asia',country:'Japan',name:'Nikkei 225',symbol:'^N225',type:'index'},
 {region:'Asia',country:'Japan',name:'TOPIX',symbol:'^TOPX',type:'index'},
 {region:'Asia',country:'Hong Kong',name:'Hang Seng',symbol:'^HSI',type:'index'},
 {region:'Asia',country:'China',name:'Shanghai Composite',symbol:'000001.SS',type:'index'},
 {region:'Asia',country:'China',name:'Shenzhen Component',symbol:'399001.SZ',type:'index'},
 {region:'Asia',country:'South Korea',name:'KOSPI',symbol:'^KS11',type:'index'},
 {region:'Asia',country:'Taiwan',name:'TAIEX',symbol:'^TWII',type:'index'},
 {region:'Asia',country:'India',name:'Nifty 50',symbol:'^NSEI',type:'index'},
 {region:'Asia',country:'India',name:'Nifty Bank',symbol:'^NSEBANK',type:'index'},
 {region:'Asia',country:'India',name:'BSE Sensex',symbol:'^BSESN',type:'index'},
 {region:'Asia',country:'Singapore',name:'Straits Times',symbol:'^STI',type:'index'},
 {region:'Asia',country:'Thailand',name:'SET',symbol:'^SET.BK',type:'index'},
 {region:'Asia',country:'Indonesia',name:'Jakarta Composite',symbol:'^JKSE',type:'index'},
 {region:'Asia',country:'Malaysia',name:'FTSE Bursa Malaysia KLCI',symbol:'^KLSE',type:'index'},
 {region:'Asia',country:'Philippines',name:'PSEi',symbol:'^PSEI.PS',type:'index'},
 {region:'Oceania',country:'Australia',name:'S&P/ASX 200',symbol:'^AXJO',type:'index'},
 {region:'Oceania',country:'New Zealand',name:'S&P/NZX 50',symbol:'^NZ50',type:'index'},
 {region:'Middle East',country:'Israel',name:'TA-125',symbol:'^TA125.TA',type:'index'},
 {region:'Middle East',country:'Saudi Arabia',name:'Tadawul All Share',symbol:'^TASI.SR',type:'index'},
 {region:'Africa',country:'South Africa',name:'FTSE/JSE All Share',symbol:'^JALSH',type:'index'},
 {region:'Africa',country:'Egypt',name:'EGX 30',symbol:'^CASE30',type:'index'}
];

export const EXCHANGE_SUFFIXES = {
 NYSE:'',NASDAQ:'',AMEX:'',
 LSE:'.L',TSE:'.T',HKG:'.HK',KSC:'.KS',KOSDAQ:'.KQ',TWSE:'.TW',
 NSE:'.NS',BSE:'.BO',ASX:'.AX',NZE:'.NZ',SIX:'.SW',XETRA:'.DE',
 EPA:'.PA',AMS:'.AS',BME:'.MC',MIL:'.MI',SAO:'.SA',MEX:'.MX',
 JKT:'.JK',KLSE:'.KL',SET:'.BK',SGX:'.SI',JNB:'.JO',TADAWUL:'.SR',TASE:'.TA'
};

export const GLOBAL_STOCK_TEST_SET = [
 ['United States','AAPL'],['United States','MSFT'],['United States','NVDA'],['Canada','RY.TO'],
 ['United Kingdom','SHEL.L'],['Germany','SAP.DE'],['France','OR.PA'],['Switzerland','NESN.SW'],
 ['Japan','7203.T'],['Hong Kong','0700.HK'],['China','600519.SS'],['South Korea','005930.KS'],
 ['Taiwan','2330.TW'],['India','RELIANCE.NS'],['Australia','BHP.AX'],['Singapore','D05.SI'],
 ['Brazil','VALE3.SA'],['Mexico','WALMEX.MX'],['South Africa','NPN.JO'],['Saudi Arabia','2222.SR']
];

export const GLOBAL_INDEX_ALIASES = Object.fromEntries(GLOBAL_INDEXES.flatMap(x=>[
 [x.name.toUpperCase(),x.symbol],
 [x.name.replace(/[^A-Z0-9]/gi,'').toUpperCase(),x.symbol]
]));

export function normalizeGlobalSymbol(input){
 const raw=String(input||'').trim();
 if(!raw)return null;
 const upper=raw.toUpperCase();
 if(GLOBAL_INDEX_ALIASES[upper])return GLOBAL_INDEX_ALIASES[upper];
 const compact=upper.replace(/[^A-Z0-9]/g,'');
 if(GLOBAL_INDEX_ALIASES[compact])return GLOBAL_INDEX_ALIASES[compact];
 if(/^\^[A-Z0-9_.-]+$/.test(upper)||/^[A-Z0-9]+(?:\.[A-Z0-9]+)?$/.test(upper))return upper;
 return null;
}
