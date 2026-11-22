/** The 10 Coinbase tokenized stocks on Base that have an onchain Chainlink feed.
 *  Feed proxies: docs.base.org "List Tokenized Stocks". Token addresses: Coinbase Tokenized Stocks API. */
export type Token = {
  symbol: string;
  ticker: string;
  token: string;
  feed: string;
};

export const TOKENS: Token[] = [
  { symbol: "NVDAc", ticker: "NVDA", token: "0xb20000000000000000000078ee7ce2fE4908108C", feed: "0x04689a41629776563E6822F76f2e57D148d28513" },
  { symbol: "TSLAc", ticker: "TSLA", token: "0xb2000000000000000000001e800a7f5189430cD0", feed: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4" },
  { symbol: "AAPLc", ticker: "AAPL", token: "0xb200000000000000000000C2e324d24d7eEcd1fb", feed: "0x787f13dEa48Db0897CbCDD985de77809D837F988" },
  { symbol: "MSFTc", ticker: "MSFT", token: "0xB200000000000000000000Ab99cFa739E253872B", feed: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c" },
  { symbol: "METAc", ticker: "META", token: "0xb2000000000000000000008bC8786B856E61707C", feed: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D" },
  { symbol: "GOOGLc", ticker: "GOOGL", token: "0xb2000000000000000000002D0BA3164cc74f58B7", feed: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2" },
  { symbol: "AMZNc", ticker: "AMZN", token: "0xb200000000000000000000d9192b6B456483C2E8", feed: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295" },
  { symbol: "MSTRc", ticker: "MSTR", token: "0xb2000000000000000000004884b426556b92883d", feed: "0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a" },
  { symbol: "SNDKc", ticker: "SNDK", token: "0xb200000000000000000000397293Cb8cda9a10c5", feed: "0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA" },
  { symbol: "SPCXc", ticker: "SPCX", token: "0xb2000000000000000000007b9fcbd005511aCBd5", feed: "0x6A634B235903C4ad6376892180d6fF8612e3Fa68" },
];

export const bySymbol = (s: string) => TOKENS.find((t) => t.symbol.toLowerCase() === s.toLowerCase());

/** A feed silent this long is treated as dark (market closed). Matches BellHook's minDarkGap. */
export const DARK_AFTER_S = 6 * 3600;
