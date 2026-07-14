import { readFileSync, statSync } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export type NewsContextChannel = 'primary' | 'venue' | 'protocol' | 'issuer' | 'tree' | 'rss' | 'lookonchain';
export type NewsContextTone = 'bad' | 'warn' | 'ok' | 'idle';
export type NewsSourceStatus = 'live' | 'delayed' | 'error';
export type NewsCategory = 'Crypto' | 'Macro' | 'Markets' | 'Regulation' | 'Exchange' | 'On-Chain' | 'Security' | 'Protocol';

export interface NewsContextItem {
  id: string;
  title: string;
  summary: string | null;
  url: string | null;
  source: string;
  sourceKey: string;
  sourceDomain: string | null;
  channel: NewsContextChannel;
  ts: number | null;
  timeLabel: string;
  symbols: string[];
  tags: string[];
  category: NewsCategory;
  tone: NewsContextTone;
  impact: 1 | 2 | 3;
}

export interface NewsContextSource {
  key: string;
  label: string;
  status: NewsSourceStatus;
  detail: string;
  fetchedAt: number | null;
  count: number;
  url: string | null;
  domain: string | null;
}

export interface NewsContextPayload {
  source: 'primary+venue+protocol+issuer+tree+rss+lookonchain';
  fetchedAt: number;
  items: NewsContextItem[];
  sources: NewsContextSource[];
}

const TREE_URL = 'https://news.treeofalpha.com/api/news?limit=200';
const TREE_HISTORY_URL = 'https://news.treeofalpha.com/api/news?limit=5000';
const LOOKONCHAIN_URL = 'https://www.lookonchain.com/ashx/index.ashx?type=1&page=1&pageSize=24';
const CACHE_MS = 5_000;
const FETCH_TIMEOUT_MS = 8_000;
const NEWS_BODY_LIMIT_BYTES = 8 * 1024 * 1024;
const FETCH_FAILURE_TTL_MS = 15_000;
const MAX_FETCH_STATE_ENTRIES = 1_024;
const TREE_MIN_FETCH_MS = 15_000;
const TREE_HISTORY_FETCH_MS = 10 * 60_000;
const LOOKONCHAIN_MIN_FETCH_MS = 15_000;
const RSS_DEFAULT_MIN_FETCH_MS = 30_000;
const PRIMARY_DEFAULT_MIN_FETCH_MS = 60_000;
const VENUE_DEFAULT_MIN_FETCH_MS = 30_000;
const PROTOCOL_DEFAULT_MIN_FETCH_MS = 120_000;
const ISSUER_DEFAULT_MIN_FETCH_MS = 120_000;
const OFFICIAL_SOURCE_CONCURRENCY = 4;
const RSS_SOURCE_CONCURRENCY = 6;
// The UI exposes exactly seven calendar days. Eight elapsed days are retained
// internally so the oldest visible day stays complete in every supported
// timezone, including UTC-12 through UTC+14.
const NEWS_ARCHIVE_RETENTION_MS = 8 * 86_400_000;
const NEWS_ARCHIVE_MAX_ITEMS = 8_000;
const NEWS_ARCHIVE_PATH = path.join(process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data'), 'news-archive.json');
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const OFFICIAL_MACRO_KEYS = new Set([
  'fed', 'bls', 'bea', 'sec', 'cftc', 'treasury', 'ofac', 'ecb', 'boe', 'boj',
  'japan-mof', 'japan-fsa', 'china-nbs', 'pboc', 'safe', 'uk-fca', 'esma',
  'bis-press', 'bis-speeches', 'bis-statistics',
]);
const VENUE_KEYS = new Set([
  'binance', 'coinbase-assets', 'kraken', 'okx', 'bybit', 'upbit-bithumb',
  'deribit', 'cme-crypto', 'exchange-status',
]);
const REGULATORY_KEYS = new Set([
  'sec', 'cftc', 'treasury', 'ofac', 'japan-fsa', 'uk-fca', 'esma',
]);
const CRYPTO_EDITORIAL_KEYS = new Set([
  'coindesk', 'the-block', 'blockworks', 'dl-news', 'unchained', 'protos',
  'the-defiant', 'crypto-news', 'ledger-insights', 'rekt', 'beincrypto',
  'cointelegraph', 'decrypt', 'cryptoslate', 'wublockchain', 'bankless',
  'watcherguru', 'chainalysis', 'trm-labs', 'elliptic',
]);
const TRUSTED_EDITORIAL_KEYS = new Set([
  'financialjuice', 'wsj-markets', 'ft-alphaville', 'cnbc-markets', 'marketwatch',
  'ap-business', 'coindesk', 'the-block', 'blockworks', 'dl-news', 'unchained',
  'protos', 'the-defiant', 'crypto-news', 'ledger-insights', 'rekt', 'kaiko',
  'glassnode-insights', 'coinshares-research',
]);

interface FeedConfig {
  key: string;
  label: string;
  url: string;
  domain: string;
  minFetchMs?: number;
  fallbackUrl?: string;
  includeKeywords?: string[];
  pageParser?: MediaPageParser;
}

type MediaPageParser = 'ap-business' | 'dl-news' | 'kaiko-blog';
type OfficialPageParser =
  | 'treasury-press'
  | 'ofac-actions'
  | 'boj-news'
  | 'nbs-releases'
  | 'pboc-home'
  | 'safe-home'
  | 'okx-announcements'
  | 'okx-status'
  | 'bybit-announcements'
  | 'circle-blog'
  | 'paxos-blog'
  | 'bitwise-insights'
  | '21shares-insights';
type OfficialJsonParser = 'coinbase-products' | 'upbit-announcements' | 'bithumb-notices' | 'bybit-system-status';
type OfficialFeedEndpoint = string | { url: string; label?: string; domain?: string; includeKeywords?: string[] };
type OfficialPageEndpoint = { url: string; parser: OfficialPageParser; label?: string; domain?: string };
type OfficialJsonEndpoint = { url: string; parser: OfficialJsonParser; label?: string; domain?: string };

interface OfficialSourceConfig {
  key: string;
  label: string;
  domain: string;
  url: string;
  detail: string;
  feeds?: OfficialFeedEndpoint[];
  pages?: OfficialPageEndpoint[];
  jsons?: OfficialJsonEndpoint[];
  minFetchMs?: number;
}

const PRIMARY_SOURCES: OfficialSourceConfig[] = [
  {
    key: 'fed',
    label: 'Federal Reserve Board',
    domain: 'federalreserve.gov',
    url: 'https://www.federalreserve.gov/feeds/feeds.htm',
    detail: 'Official Fed press, FOMC, speech/testimony, and supervision feeds.',
    feeds: [
      'https://www.federalreserve.gov/feeds/press_all.xml',
      'https://www.federalreserve.gov/feeds/press_monetary.xml',
      'https://www.federalreserve.gov/feeds/speeches_and_testimony.xml',
      'https://www.federalreserve.gov/feeds/bankinginfo-rss.xml',
    ],
  },
  {
    key: 'bls',
    label: 'BLS',
    domain: 'bls.gov',
    url: 'https://www.bls.gov/feed/',
    detail: 'Official BLS CPI, jobs, JOLTS, PPI, import/export prices, ECI, and productivity feeds.',
    feeds: [
      'https://www.bls.gov/feed/empsit.rss',
      'https://www.bls.gov/feed/jolts.rss',
      'https://www.bls.gov/feed/cpi.rss',
      'https://www.bls.gov/feed/ppi.rss',
      'https://www.bls.gov/feed/ximpim.rss',
      'https://www.bls.gov/feed/eci.rss',
      'https://www.bls.gov/feed/prod2.rss',
    ],
  },
  {
    key: 'bea',
    label: 'BEA',
    domain: 'bea.gov',
    url: 'https://www.bea.gov/news/schedule',
    detail: 'Official BEA release RSS and machine-readable release schedule source.',
    feeds: ['https://apps.bea.gov/rss/rss.xml'],
  },
  {
    key: 'sec',
    label: 'SEC',
    domain: 'sec.gov',
    url: 'https://www.sec.gov/about/rss-feeds',
    detail: 'Official SEC press, statements, testimony, litigation, administrative, and trading suspension feeds.',
    feeds: [
      'https://www.sec.gov/news/pressreleases.rss',
      'https://www.sec.gov/news/speeches-statements.rss',
      'https://www.sec.gov/news/testimony.rss',
      'https://www.sec.gov/news/statements.rss',
      'https://www.sec.gov/enforcement-litigation/litigation-releases/rss',
      'https://www.sec.gov/enforcement-litigation/administrative-proceedings/rss',
      'https://www.sec.gov/enforcement-litigation/trading-suspensions/rss',
    ],
  },
  {
    key: 'cftc',
    label: 'CFTC',
    domain: 'cftc.gov',
    url: 'https://www.cftc.gov/RSS/index.htm',
    detail: 'Official CFTC press, enforcement, speeches, and Federal Register feeds.',
    // CFTC's comments.gov Federal Register RSS endpoints now return "RSS Feed has been removed";
    // keep the working official CFTC feeds live instead of surfacing dead rows.
    feeds: [
      'https://www.cftc.gov/RSS/RSSGP/rssgp.xml',
      'https://www.cftc.gov/RSS/RSSENF/rssenf.xml',
      'https://www.cftc.gov/RSS/RSSST/rssst.xml',
    ],
  },
  {
    key: 'treasury',
    label: 'U.S. Treasury',
    domain: 'home.treasury.gov',
    url: 'https://home.treasury.gov/news/press-releases',
    detail: 'Official Treasury press releases parsed from the Treasury site.',
    pages: [{ url: 'https://home.treasury.gov/news/press-releases', parser: 'treasury-press' }],
  },
  {
    key: 'ofac',
    label: 'OFAC',
    domain: 'ofac.treasury.gov',
    url: 'https://ofac.treasury.gov/recent-actions',
    detail: 'Official OFAC recent actions parsed from the Treasury OFAC site.',
    pages: [{ url: 'https://ofac.treasury.gov/recent-actions', parser: 'ofac-actions' }],
  },
  {
    key: 'ecb',
    label: 'ECB',
    domain: 'ecb.europa.eu',
    url: 'https://www.ecb.europa.eu/home/html/rss.en.html',
    detail: 'Official ECB press, statistical releases, publications, and market operations feeds.',
    feeds: [
      'https://www.ecb.europa.eu/rss/press.html',
      'https://www.ecb.europa.eu/rss/statpress.html',
      'https://www.ecb.europa.eu/rss/pub.html',
      'https://www.ecb.europa.eu/rss/operations.html',
    ],
  },
  {
    key: 'boe',
    label: 'Bank of England',
    domain: 'bankofengland.co.uk',
    url: 'https://www.bankofengland.co.uk/rss',
    detail: 'Official Bank of England news, publications, speeches, and statistics feeds.',
    feeds: [
      'https://www.bankofengland.co.uk/rss/news',
      'https://www.bankofengland.co.uk/rss/publications',
      'https://www.bankofengland.co.uk/rss/speeches',
      'https://www.bankofengland.co.uk/rss/statistics',
    ],
  },
  {
    key: 'boj',
    label: 'Bank of Japan',
    domain: 'boj.or.jp',
    url: 'https://www.boj.or.jp/en/whatsnew/index.htm',
    detail: 'Official Bank of Japan news list parsed because the public RSS link currently returns not found.',
    pages: [{ url: 'https://www.boj.or.jp/en/whatsnew/index.htm', parser: 'boj-news' }],
  },
  {
    key: 'japan-mof',
    label: 'Japan MOF',
    domain: 'mof.go.jp',
    url: 'https://www.mof.go.jp/english/about_mof/rss/index.html',
    detail: 'Official Ministry of Finance Japan what-new feed.',
    feeds: ['https://www.mof.go.jp/english/news.rss'],
  },
  {
    key: 'china-nbs',
    label: 'China NBS',
    domain: 'stats.gov.cn',
    url: 'https://www.stats.gov.cn/english/PressRelease/',
    detail: 'Official China NBS latest releases parsed carefully from the agency site.',
    pages: [{ url: 'https://www.stats.gov.cn/english/PressRelease/', parser: 'nbs-releases' }],
  },
  {
    key: 'pboc',
    label: 'PBoC',
    domain: 'pbc.gov.cn',
    url: 'https://www.pbc.gov.cn/en/3688006/index.html',
    detail: 'Official PBoC English recent developments parsed carefully from the central bank site.',
    pages: [{ url: 'https://www.pbc.gov.cn/en/3688006/index.html', parser: 'pboc-home' }],
  },
  {
    key: 'safe',
    label: 'SAFE',
    domain: 'safe.gov.cn',
    url: 'https://www.safe.gov.cn/en/SAFENews/index.html',
    detail: 'Official SAFE English news and FX reserve/statistics rows parsed carefully from the agency site.',
    pages: [
      { url: 'https://www.safe.gov.cn/en/SAFENews/index.html', parser: 'safe-home' },
      { url: 'https://www.safe.gov.cn/en/DataandStatistics/index.html', parser: 'safe-home' },
    ],
  },
];

const VENUE_SOURCES: OfficialSourceConfig[] = [
  {
    key: 'coinbase-assets',
    label: 'Coinbase / Coinbase Assets',
    domain: 'coinbase.com',
    url: 'https://api.exchange.coinbase.com/products',
    detail: 'Official Coinbase Exchange product API for trading phases and availability. Coinbase listing announcements now live on Coinbase Markets on X.',
    jsons: [
      { url: 'https://api.exchange.coinbase.com/products', parser: 'coinbase-products', label: 'Coinbase Exchange', domain: 'coinbase.com' },
    ],
    minFetchMs: 120_000,
  },
  {
    key: 'kraken',
    label: 'Kraken',
    domain: 'blog.kraken.com',
    url: 'https://blog.kraken.com/category/product/asset-listings/',
    detail: 'Official Kraken asset-listing and product update feed.',
    feeds: [
      { url: 'https://blog.kraken.com/category/product/asset-listings/feed', label: 'Kraken', domain: 'blog.kraken.com' },
    ],
  },
  {
    key: 'okx',
    label: 'OKX',
    domain: 'okx.com',
    url: 'https://www.okx.com/help/section/announcements-new-listings',
    detail: 'Official OKX listing, delisting, trading update, wallet, and Web3 announcement pages.',
    pages: [
      { url: 'https://www.okx.com/help/section/announcements-new-listings', parser: 'okx-announcements' },
      { url: 'https://www.okx.com/help/section/announcements-delistings', parser: 'okx-announcements' },
      { url: 'https://www.okx.com/help/section/announcements-trading-updates', parser: 'okx-announcements' },
      { url: 'https://www.okx.com/help/section/announcements-deposit-withdrawal-suspension-resumption', parser: 'okx-announcements' },
      { url: 'https://www.okx.com/help/section/announcements-web3', parser: 'okx-announcements' },
    ],
  },
  {
    key: 'bybit',
    label: 'Bybit',
    domain: 'announcements.bybit.com',
    url: 'https://announcements.bybit.com/en/',
    detail: 'Official Bybit listings, delistings, derivatives, launch, and maintenance announcements.',
    pages: [
      { url: 'https://announcements.bybit.com/en/?category=new_crypto', parser: 'bybit-announcements' },
      { url: 'https://announcements.bybit.com/en/?category=delistings', parser: 'bybit-announcements' },
      { url: 'https://announcements.bybit.com/en/?category=maintenance_updates', parser: 'bybit-announcements' },
    ],
  },
  {
    key: 'upbit-bithumb',
    label: 'Upbit / Bithumb',
    domain: 'upbit.com',
    url: 'https://upbit.com/service_center/notice',
    detail: 'Official Korean exchange notices for listings, delistings, deposits, withdrawals, and risk-designation events.',
    jsons: [
      {
        url: 'https://api-manager.upbit.com/api/v1/announcements?os=web&page=1&per_page=20&category=all',
        parser: 'upbit-announcements',
        label: 'Upbit',
        domain: 'upbit.com',
      },
      { url: 'https://api.bithumb.com/v1/notices', parser: 'bithumb-notices', label: 'Bithumb', domain: 'bithumb.com' },
    ],
  },
  {
    key: 'deribit',
    label: 'Deribit',
    domain: 'insights.deribit.com',
    url: 'https://insights.deribit.com/exchange-updates/',
    detail: 'Official Deribit exchange updates for options/futures instruments, fee schedules, delivery, and platform changes.',
    feeds: [
      { url: 'https://insights.deribit.com/exchange-updates/feed/', label: 'Deribit', domain: 'insights.deribit.com' },
    ],
  },
  {
    key: 'cme-crypto',
    label: 'CME Group Crypto Notices',
    domain: 'cmegroup.com',
    url: 'https://www.cmegroup.com/rss.html',
    detail: 'Official CME press release and Globex notice feeds filtered for crypto futures/options terms.',
    feeds: [
      {
        url: 'https://feeds.feedburner.com/mediaroom/CMsF',
        label: 'CME Group Press Releases',
        domain: 'cmegroup.com',
        includeKeywords: ['crypto', 'cryptocurrency', 'bitcoin', 'ether', 'ethereum', 'xrp', 'solana', 'cardano', 'chainlink', 'stellar'],
      },
      {
        url: 'https://feeds.feedburner.com/GlobexAdvisories',
        label: 'CME Globex Notice',
        domain: 'cmegroup.com',
        includeKeywords: ['crypto', 'cryptocurrency', 'bitcoin', 'ether', 'ethereum', 'xrp', 'solana', 'cardano', 'chainlink', 'stellar'],
      },
    ],
    minFetchMs: 185_000,
  },
  {
    key: 'exchange-status',
    label: 'Exchange Status Pages',
    domain: 'status.coinbase.com',
    url: 'https://status.coinbase.com/',
    detail: 'Official exchange incident/status feeds and maintenance endpoints for Coinbase, Kraken, OKX, and Bybit.',
    feeds: [
      { url: 'https://status.coinbase.com/history.rss', label: 'Coinbase Status', domain: 'status.coinbase.com' },
      { url: 'https://status.kraken.com/history.rss', label: 'Kraken Status', domain: 'status.kraken.com' },
    ],
    pages: [
      { url: 'https://www.okx.com/en-us/status', parser: 'okx-status', label: 'OKX Status', domain: 'okx.com' },
    ],
    jsons: [
      { url: 'https://api.bybit.com/v5/system/status', parser: 'bybit-system-status', label: 'Bybit System Status', domain: 'bybit.com' },
    ],
    minFetchMs: 120_000,
  },
];

const PROTOCOL_SOURCES: OfficialSourceConfig[] = [
  {
    key: 'ethereum-foundation',
    label: 'Ethereum Foundation',
    domain: 'ethereum.org',
    url: 'https://blog.ethereum.org/',
    detail: 'Official Ethereum Foundation blog feed for protocol and ecosystem announcements.',
    feeds: [{ url: 'https://blog.ethereum.org/feed.xml', label: 'Ethereum Foundation', domain: 'ethereum.org' }],
  },
  {
    key: 'bitcoin-core',
    label: 'Bitcoin Core',
    domain: 'bitcoincore.org',
    url: 'https://github.com/bitcoin/bitcoin/releases',
    detail: 'Official Bitcoin Core GitHub release feed.',
    feeds: [{ url: 'https://github.com/bitcoin/bitcoin/releases.atom', label: 'Bitcoin Core', domain: 'bitcoincore.org' }],
  },
  {
    key: 'geth',
    label: 'Geth',
    domain: 'geth.ethereum.org',
    url: 'https://github.com/ethereum/go-ethereum/releases',
    detail: 'Official go-ethereum GitHub release feed.',
    feeds: [{ url: 'https://github.com/ethereum/go-ethereum/releases.atom', label: 'Geth', domain: 'geth.ethereum.org' }],
  },
  {
    key: 'nethermind',
    label: 'Nethermind',
    domain: 'nethermind.io',
    url: 'https://github.com/NethermindEth/nethermind/releases',
    detail: 'Official Nethermind GitHub release feed.',
    feeds: [{ url: 'https://github.com/NethermindEth/nethermind/releases.atom', label: 'Nethermind', domain: 'nethermind.io' }],
  },
  {
    key: 'prysm',
    label: 'Prysm',
    domain: 'offchainlabs.com',
    url: 'https://github.com/OffchainLabs/prysm/releases',
    detail: 'Official Prysm GitHub release feed.',
    feeds: [{ url: 'https://github.com/OffchainLabs/prysm/releases.atom', label: 'Prysm', domain: 'offchainlabs.com' }],
  },
  {
    key: 'lighthouse',
    label: 'Lighthouse',
    domain: 'sigmaprime.io',
    url: 'https://github.com/sigp/lighthouse/releases',
    detail: 'Official Lighthouse GitHub release feed.',
    feeds: [{ url: 'https://github.com/sigp/lighthouse/releases.atom', label: 'Lighthouse', domain: 'sigmaprime.io' }],
  },
  {
    key: 'solana-agave',
    label: 'Solana Agave',
    domain: 'solana.com',
    url: 'https://github.com/anza-xyz/agave/releases',
    detail: 'Official Anza Agave GitHub release feed for the Solana validator client.',
    feeds: [{ url: 'https://github.com/anza-xyz/agave/releases.atom', label: 'Solana Agave', domain: 'solana.com' }],
  },
  {
    key: 'arbitrum-nitro',
    label: 'Arbitrum Nitro',
    domain: 'arbitrum.io',
    url: 'https://github.com/OffchainLabs/nitro/releases',
    detail: 'Official Arbitrum Nitro GitHub release feed.',
    feeds: [{ url: 'https://github.com/OffchainLabs/nitro/releases.atom', label: 'Arbitrum Nitro', domain: 'arbitrum.io' }],
  },
  {
    key: 'optimism',
    label: 'Optimism',
    domain: 'optimism.io',
    url: 'https://github.com/ethereum-optimism/optimism/releases',
    detail: 'Official Optimism monorepo GitHub release feed.',
    feeds: [{ url: 'https://github.com/ethereum-optimism/optimism/releases.atom', label: 'Optimism', domain: 'optimism.io' }],
  },
  {
    key: 'base-status',
    label: 'Base Status',
    domain: 'base.org',
    url: 'https://status.base.org/',
    detail: 'Official Base incident and status history feed.',
    feeds: [{ url: 'https://status.base.org/history.rss', label: 'Base Status', domain: 'base.org' }],
  },
  {
    key: 'polygon-status',
    label: 'Polygon Status',
    domain: 'polygon.technology',
    url: 'https://status.polygon.technology/',
    detail: 'Official Polygon status history feed.',
    feeds: [{ url: 'https://status.polygon.technology/history.rss', label: 'Polygon Status', domain: 'polygon.technology' }],
  },
  {
    key: 'avalanchego',
    label: 'AvalancheGo',
    domain: 'avax.network',
    url: 'https://github.com/ava-labs/avalanchego/releases',
    detail: 'Official AvalancheGo GitHub release feed.',
    feeds: [{ url: 'https://github.com/ava-labs/avalanchego/releases.atom', label: 'AvalancheGo', domain: 'avax.network' }],
  },
  {
    key: 'cosmos-gaia',
    label: 'Cosmos Gaia',
    domain: 'cosmos.network',
    url: 'https://github.com/cosmos/gaia/releases',
    detail: 'Official Cosmos Gaia GitHub release feed.',
    feeds: [{ url: 'https://github.com/cosmos/gaia/releases.atom', label: 'Cosmos Gaia', domain: 'cosmos.network' }],
  },
  {
    key: 'celestia-node',
    label: 'Celestia Node',
    domain: 'celestia.org',
    url: 'https://github.com/celestiaorg/celestia-node/releases',
    detail: 'Official Celestia Node GitHub release feed.',
    feeds: [{ url: 'https://github.com/celestiaorg/celestia-node/releases.atom', label: 'Celestia Node', domain: 'celestia.org' }],
  },
  {
    key: 'sui',
    label: 'Sui',
    domain: 'sui.io',
    url: 'https://github.com/MystenLabs/sui/releases',
    detail: 'Official Sui GitHub release feed.',
    feeds: [{ url: 'https://github.com/MystenLabs/sui/releases.atom', label: 'Sui', domain: 'sui.io' }],
  },
  {
    key: 'aptos-core',
    label: 'Aptos Core',
    domain: 'aptosfoundation.org',
    url: 'https://github.com/aptos-labs/aptos-core/releases',
    detail: 'Official Aptos Core GitHub release feed.',
    feeds: [{ url: 'https://github.com/aptos-labs/aptos-core/releases.atom', label: 'Aptos Core', domain: 'aptosfoundation.org' }],
  },
  {
    key: 'chainlink',
    label: 'Chainlink',
    domain: 'chain.link',
    url: 'https://github.com/smartcontractkit/chainlink/releases',
    detail: 'Official Chainlink GitHub release feed.',
    feeds: [{ url: 'https://github.com/smartcontractkit/chainlink/releases.atom', label: 'Chainlink', domain: 'chain.link' }],
  },
  {
    key: 'uniswap-v4',
    label: 'Uniswap v4',
    domain: 'uniswap.org',
    url: 'https://github.com/Uniswap/v4-core/releases',
    detail: 'Official Uniswap v4 core GitHub release feed.',
    feeds: [{ url: 'https://github.com/Uniswap/v4-core/releases.atom', label: 'Uniswap v4', domain: 'uniswap.org' }],
  },
  {
    key: 'aave-v3',
    label: 'Aave v3',
    domain: 'aave.com',
    url: 'https://github.com/aave/aave-v3-core/releases',
    detail: 'Official Aave v3 core GitHub release feed.',
    feeds: [{ url: 'https://github.com/aave/aave-v3-core/releases.atom', label: 'Aave v3', domain: 'aave.com' }],
  },
  {
    key: 'lido',
    label: 'Lido',
    domain: 'lido.fi',
    url: 'https://blog.lido.fi/',
    detail: 'Official Lido blog feed for protocol and staking announcements.',
    feeds: [{ url: 'https://blog.lido.fi/rss/', label: 'Lido', domain: 'lido.fi' }],
  },
  {
    key: 'eigenlayer',
    label: 'EigenLayer',
    domain: 'eigenlayer.xyz',
    url: 'https://blog.eigenlayer.xyz/',
    detail: 'Official EigenLayer blog feed for protocol and ecosystem announcements.',
    feeds: [{ url: 'https://blog.eigenlayer.xyz/rss/', label: 'EigenLayer', domain: 'eigenlayer.xyz' }],
  },
  {
    key: 'sky-forum',
    label: 'Sky / Maker Forum',
    domain: 'forum.sky.money',
    url: 'https://forum.sky.money/latest',
    detail: 'Official Sky governance forum RSS feed.',
    feeds: [{ url: 'https://forum.sky.money/latest.rss', label: 'Sky / Maker Forum', domain: 'forum.sky.money' }],
  },
  {
    key: 'curve',
    label: 'Curve Protocol',
    domain: 'curve.fi',
    url: 'https://github.com/curvefi',
    detail: 'Official Curve contract and stablecoin GitHub release feeds.',
    feeds: [
      { url: 'https://github.com/curvefi/curve-contract/releases.atom', label: 'Curve Contracts', domain: 'curve.fi' },
      { url: 'https://github.com/curvefi/curve-dao-contracts/releases.atom', label: 'Curve DAO', domain: 'curve.fi' },
      { url: 'https://github.com/curvefi/curve-stablecoin/releases.atom', label: 'Curve Stablecoin', domain: 'curve.fi' },
    ],
  },
  {
    key: 'dydx',
    label: 'dYdX',
    domain: 'dydx.exchange',
    url: 'https://github.com/dydxprotocol/v4-chain/releases',
    detail: 'Official dYdX v4 chain GitHub release feed.',
    feeds: [{ url: 'https://github.com/dydxprotocol/v4-chain/releases.atom', label: 'dYdX', domain: 'dydx.exchange' }],
  },
  {
    key: 'jito-solana',
    label: 'Jito Solana',
    domain: 'jito.network',
    url: 'https://github.com/jito-foundation/jito-solana/releases',
    detail: 'Official Jito Solana GitHub release feed.',
    feeds: [{ url: 'https://github.com/jito-foundation/jito-solana/releases.atom', label: 'Jito Solana', domain: 'jito.network' }],
  },
  {
    key: 'jupiter-cpi',
    label: 'Jupiter',
    domain: 'jup.ag',
    url: 'https://github.com/jup-ag/jupiter-cpi/releases',
    detail: 'Official Jupiter GitHub release feed with currently published release rows.',
    feeds: [{ url: 'https://github.com/jup-ag/jupiter-cpi/releases.atom', label: 'Jupiter', domain: 'jup.ag' }],
  },
  {
    key: 'wormhole',
    label: 'Wormhole',
    domain: 'wormhole.com',
    url: 'https://github.com/wormhole-foundation/wormhole/releases',
    detail: 'Official Wormhole GitHub release feed.',
    feeds: [{ url: 'https://github.com/wormhole-foundation/wormhole/releases.atom', label: 'Wormhole', domain: 'wormhole.com' }],
  },
  {
    key: 'layerzero-v2',
    label: 'LayerZero v2',
    domain: 'layerzero.network',
    url: 'https://github.com/LayerZero-Labs/LayerZero-v2/releases',
    detail: 'Official LayerZero v2 GitHub release feed.',
    feeds: [{ url: 'https://github.com/LayerZero-Labs/LayerZero-v2/releases.atom', label: 'LayerZero v2', domain: 'layerzero.network' }],
  },
];

const ISSUER_SOURCES: OfficialSourceConfig[] = [
  {
    key: 'tether',
    label: 'Tether',
    domain: 'tether.io',
    url: 'https://tether.io/news',
    detail: 'Official Tether feed for issuer and reserve/newsroom announcements.',
    feeds: [{ url: 'https://tether.io/feed/', label: 'Tether', domain: 'tether.io' }],
  },
  {
    key: 'paypal-usd',
    label: 'PayPal USD',
    domain: 'paypal.com',
    url: 'https://newsroom.paypal-corp.com/news',
    detail: 'Official PayPal newsroom RSS filtered for PYUSD, stablecoin, and digital-asset terms.',
    feeds: [{
      url: 'https://newsroom.paypal-corp.com/news?pagetemplate=rss',
      label: 'PayPal USD',
      domain: 'paypal.com',
      includeKeywords: ['pyusd', 'paypal usd', 'stablecoin', 'stable coin', 'crypto', 'cryptocurrency', 'digital asset', 'blockchain'],
    }],
  },
  {
    key: 'fidelity-digital-assets',
    label: 'Fidelity Digital Assets',
    domain: 'fidelitydigitalassets.com',
    url: 'https://www.fidelitydigitalassets.com/',
    detail: 'Official Fidelity Digital Assets RSS feed for institutional crypto research and product updates.',
    feeds: [{ url: 'https://www.fidelitydigitalassets.com/rss.xml', label: 'Fidelity Digital Assets', domain: 'fidelitydigitalassets.com' }],
  },
  {
    key: 'circle',
    label: 'Circle',
    domain: 'circle.com',
    url: 'https://www.circle.com/blog',
    detail: 'Official Circle blog metadata for stablecoin, payments, reserve, policy, and product announcements.',
    pages: [{ url: 'https://www.circle.com/blog', parser: 'circle-blog' }],
  },
  {
    key: 'paxos',
    label: 'Paxos',
    domain: 'paxos.com',
    url: 'https://www.paxos.com/blog',
    detail: 'Official Paxos newsroom for regulated stablecoin, brokerage, custody, and product announcements.',
    pages: [{ url: 'https://www.paxos.com/blog', parser: 'paxos-blog' }],
  },
  {
    key: 'bitwise',
    label: 'Bitwise',
    domain: 'bitwiseinvestments.com',
    url: 'https://bitwiseinvestments.com/crypto-market-insights',
    detail: 'Official Bitwise crypto market research and ETF insight pages.',
    pages: [{ url: 'https://bitwiseinvestments.com/crypto-market-insights', parser: 'bitwise-insights' }],
  },
  {
    key: '21shares',
    label: '21Shares',
    domain: '21shares.com',
    url: 'https://www.21shares.com/en-us/insights',
    detail: 'Official 21Shares digital-asset and ETF research pages.',
    pages: [{ url: 'https://www.21shares.com/en-us/insights', parser: '21shares-insights' }],
  },
];

const RSS_FEEDS: FeedConfig[] = [
  {
    key: 'bis-press', label: 'BIS Press Releases', url: 'https://www.bis.org/doclist/all_pressrels.rss', domain: 'bis.org', minFetchMs: 185_000,
    includeKeywords: ['crypto', 'token', 'stablecoin', 'market', 'monetary', 'rate', 'inflation', 'central bank', 'liquidity', 'capital', 'banking', 'financial'],
  },
  {
    key: 'bis-speeches', label: 'BIS Central Bank Speeches', url: 'https://www.bis.org/doclist/cbspeeches.rss', domain: 'bis.org', minFetchMs: 185_000,
    includeKeywords: ['crypto', 'token', 'stablecoin', 'market', 'monetary', 'rate', 'inflation', 'central bank', 'liquidity', 'capital', 'banking', 'financial'],
  },
  { key: 'bis-statistics', label: 'BIS Statistics', url: 'https://www.bis.org/doclist/all_statistics.rss', domain: 'bis.org', minFetchMs: 185_000 },
  { key: 'japan-fsa', label: 'Japan FSA', url: 'https://www.fsa.go.jp/fsaNewsListAll_rss2.xml', domain: 'fsa.go.jp', minFetchMs: 185_000 },
  {
    key: 'uk-fca', label: 'UK Financial Conduct Authority', url: 'https://www.fca.org.uk/news/rss.xml', domain: 'fca.org.uk', minFetchMs: 60_000,
    includeKeywords: ['crypto', 'market', 'fund', 'asset', 'trading', 'stablecoin', 'investment', 'financial', 'enforcement'],
  },
  {
    key: 'esma', label: 'ESMA', url: 'https://www.esma.europa.eu/rss.xml', domain: 'esma.europa.eu', minFetchMs: 60_000,
    includeKeywords: ['crypto', 'market', 'fund', 'asset', 'trading', 'stablecoin', 'investment', 'financial', 'enforcement'],
  },
  { key: 'crypto-news', label: 'Crypto.news', url: 'https://crypto.news/feed/', domain: 'crypto.news', minFetchMs: 30_000 },
  { key: 'ledger-insights', label: 'Ledger Insights', url: 'https://www.ledgerinsights.com/feed/', domain: 'ledgerinsights.com', minFetchMs: 60_000 },
  { key: 'rekt', label: 'Rekt', url: 'https://www.rekt.news/rss/feed.xml', domain: 'rekt.news', minFetchMs: 185_000 },
  { key: 'beincrypto', label: 'BeInCrypto', url: 'https://beincrypto.com/feed/', domain: 'beincrypto.com', minFetchMs: 30_000 },
  { key: 'coinshares-research', label: 'CoinShares Research', url: 'https://researchblog.coinshares.com/feed', domain: 'coinshares.com', minFetchMs: 185_000 },
  {
    key: 'financialjuice', label: 'FinancialJuice', url: 'https://www.financialjuice.com/feed.ashx', domain: 'financialjuice.com', minFetchMs: 15_000,
    includeKeywords: ['fed', 'ecb', 'boj', 'rate', 'inflation', 'cpi', 'ppi', 'payroll', 'jobs', 'gdp', 'treasury', 'bond', 'oil', 'gold', 'dollar', 'bitcoin', 'ethereum', 'crypto'],
  },
  { key: 'wsj-markets', label: 'WSJ Markets RSS', url: 'https://feeds.content.dowjones.io/public/rss/RSSMarketsMain', domain: 'wsj.com' },
  { key: 'benzinga', label: 'Benzinga', url: 'https://www.benzinga.com/feed', domain: 'benzinga.com' },
  { key: 'ft-alphaville', label: 'FT Alphaville', url: 'https://www.ft.com/alphaville?format=rss', domain: 'ft.com' },
  {
    key: 'cnbc-markets',
    label: 'CNBC Markets',
    url: 'https://www.cnbc.com/id/15839069/device/rss/rss.html',
    domain: 'cnbc.com',
    includeKeywords: [
      'market', 'markets', 'stock', 'stocks', 'shares', 'nasdaq', 'dow', 's&p', 'earnings',
      'fed', 'rates', 'inflation', 'treasury', 'bond', 'oil', 'dollar', 'futures', 'options', 'crypto',
    ],
  },
  {
    key: 'marketwatch',
    label: 'MarketWatch',
    url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories',
    domain: 'marketwatch.com',
    includeKeywords: [
      'market', 'markets', 'stock', 'stocks', 'shares', 'investor', 'investors', 'oil', 'energy',
      'dollar', 'treasury', 'bond', 'fed', 'inflation', 'rates', 'nvidia', 'earnings', 'wall street',
    ],
  },
  { key: 'yahoo-finance', label: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rss', domain: 'finance.yahoo.com' },
  {
    key: 'investing-news',
    label: 'Investing.com News',
    url: 'https://www.investing.com/rss/news.rss',
    domain: 'investing.com',
    includeKeywords: [
      'market', 'stock', 'stocks', 'shares', 'nasdaq', 's&p', 'dow', 'fed', 'rates', 'inflation',
      'economy', 'economic', 'oil', 'gold', 'dollar', 'treasury', 'bond', 'crypto', 'bitcoin', 'earnings',
    ],
  },
  {
    key: 'nasdaq-news', label: 'Nasdaq News / Market Activity', url: 'https://www.nasdaq.com/feed/rssoutbound?category=Market%20Activity', domain: 'nasdaq.com',
    includeKeywords: ['market', 'nasdaq', 's&p', 'dow', 'fed', 'rate', 'inflation', 'treasury', 'bond', 'oil', 'gold', 'dollar', 'bitcoin', 'ethereum', 'crypto'],
  },
  {
    key: 'ap-business',
    label: 'AP Business',
    url: 'https://apnews.com/business',
    domain: 'apnews.com',
    pageParser: 'ap-business',
    minFetchMs: 185_000,
  },
  { key: 'coindesk', label: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', domain: 'coindesk.com' },
  { key: 'the-block', label: 'The Block', url: 'https://www.theblock.co/rss.xml', domain: 'theblock.co', minFetchMs: 185_000 },
  { key: 'blockworks', label: 'Blockworks', url: 'https://blockworks.com/feed', domain: 'blockworks.com' },
  {
    key: 'dl-news',
    label: 'DL News',
    url: 'https://www.dlnews.com/rss/',
    domain: 'dlnews.com',
    pageParser: 'dl-news',
    minFetchMs: 185_000,
  },
  { key: 'unchained', label: 'Unchained', url: 'https://unchainedcrypto.com/feed/', domain: 'unchainedcrypto.com' },
  { key: 'protos', label: 'Protos', url: 'https://protos.com/feed/', domain: 'protos.com' },
  { key: 'the-defiant', label: 'The Defiant', url: 'https://thedefiant.io/api/feed', domain: 'thedefiant.io' },
  {
    key: 'kaiko',
    label: 'Kaiko Research',
    url: 'https://www.kaiko.com/resources/categories/data-blog',
    domain: 'kaiko.com',
    pageParser: 'kaiko-blog',
    minFetchMs: 185_000,
  },
  { key: 'bankless', label: 'Bankless', url: 'https://www.bankless.com/rss/feed', domain: 'bankless.com', minFetchMs: 60_000 },
  { key: 'glassnode-insights', label: 'Glassnode Insights', url: 'https://research.glassnode.com/rss/', domain: 'research.glassnode.com', minFetchMs: 185_000 },
  { key: 'chainalysis', label: 'Chainalysis', url: 'https://www.chainalysis.com/feed/', domain: 'chainalysis.com', minFetchMs: 185_000 },
  { key: 'trm-labs', label: 'TRM Labs', url: 'https://www.trmlabs.com/resources/blog/rss.xml', domain: 'trmlabs.com', minFetchMs: 185_000 },
  { key: 'elliptic', label: 'Elliptic', url: 'https://www.elliptic.co/blog/rss.xml', domain: 'elliptic.co', minFetchMs: 185_000 },
  { key: 'wublockchain', label: 'WuBlockchain / Substack', url: 'https://wublock.substack.com/feed', domain: 'wublock.substack.com' },
  {
    key: 'zerohedge',
    label: 'ZeroHedge',
    url: 'https://cms.zerohedge.com/fullrss2.xml',
    domain: 'zerohedge.com',
    minFetchMs: 60_000,
    includeKeywords: ['market', 'fed', 'rate', 'inflation', 'treasury', 'bond', 'yield', 'oil', 'gold', 'dollar', 'bitcoin', 'ethereum', 'crypto'],
  },
  {
    key: 'watcherguru',
    label: 'WatcherGuru',
    url: 'https://watcher.guru/news/feed',
    domain: 'watcher.guru',
    minFetchMs: 60_000,
    includeKeywords: ['bitcoin', 'ethereum', 'crypto', 'blockchain', 'stablecoin', 'exchange', 'binance', 'coinbase', 'sec', 'etf', 'fed', 'market'],
  },
  { key: 'cointelegraph', label: 'Cointelegraph', url: 'https://cointelegraph.com/rss', domain: 'cointelegraph.com' },
  { key: 'decrypt', label: 'Decrypt', url: 'https://decrypt.co/feed', domain: 'decrypt.co' },
  { key: 'cryptoslate', label: 'CryptoSlate', url: 'https://cryptoslate.com/feed/', domain: 'cryptoslate.com', fallbackUrl: 'https://cryptoslate.com/news/' },
] as const satisfies FeedConfig[];
type RssFeed = FeedConfig;
type RssFetchResult = { items: NewsContextItem[]; source: NewsContextSource };

const COMMON_SYMBOLS = new Set([
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'TRX', 'AVAX', 'LINK',
  'TON', 'SUI', 'ARB', 'OP', 'APT', 'SEI', 'ENA', 'WLFI', 'USD1', 'USDT',
  'USDC', 'HYPE', 'PEPE', 'WIF', 'SHIB', 'FLOKI', 'AI', 'MSTR',
]);

let archive = loadNewsArchive();
let cache: NewsContextPayload | null = archive.length ? {
  source: 'primary+venue+protocol+issuer+tree+rss+lookonchain',
  // Mark the bootstrap snapshot stale so the first caller starts a background
  // live sweep while still receiving the persisted tape immediately.
  fetchedAt: Date.now() - CACHE_MS,
  items: archive.slice(0, NEWS_ARCHIVE_MAX_ITEMS),
  sources: bootstrapNewsSources(),
} : null;
let inFlight: Promise<NewsContextPayload> | null = null;
let treeSourceCache: (RssFetchResult & { fetchedAt: number }) | null = null;
let treeHistoryFetchedAt = 0;
let lookonchainSourceCache: (RssFetchResult & { fetchedAt: number }) | null = null;
const subscribers = new Set<(payload: NewsContextPayload) => void>();
const rssSourceCache = new Map<string, RssFetchResult & { fetchedAt: number }>();
const primarySourceCache = new Map<string, RssFetchResult & { fetchedAt: number }>();
const venueSourceCache = new Map<string, RssFetchResult & { fetchedAt: number }>();
const protocolSourceCache = new Map<string, RssFetchResult & { fetchedAt: number }>();
const issuerSourceCache = new Map<string, RssFetchResult & { fetchedAt: number }>();
let archivePersistedAt = 0;
let archivePersistTail: Promise<void> = Promise.resolve();
const bodyInFlight = new Map<string, Promise<string>>();
const bodyFailures = new Map<string, { until: number; message: string }>();
let configuredFetchHosts: Set<string> | null = null;

function bootstrapNewsSources(): NewsContextSource[] {
  const configured = [
    ...PRIMARY_SOURCES,
    ...VENUE_SOURCES,
    ...PROTOCOL_SOURCES,
    ...ISSUER_SOURCES,
    ...RSS_FEEDS,
    { key: 'tree', label: 'Tree Of Alpha Relay', url: TREE_URL, domain: 'treeofalpha.com' },
    { key: 'lookonchain', label: 'Lookonchain', url: LOOKONCHAIN_URL, domain: 'lookonchain.com' },
  ];
  const seen = new Set<string>();
  return configured
    .filter((source) => {
      if (seen.has(source.key)) return false;
      seen.add(source.key);
      return true;
    })
    .map((source) => ({
      key: source.key,
      label: source.label,
      status: 'delayed' as const,
      detail: 'Loading the latest source state.',
      fetchedAt: null,
      count: 0,
      url: source.url,
      domain: source.domain,
    }));
}

function loadNewsArchive(): NewsContextItem[] {
  try {
    if (statSync(NEWS_ARCHIVE_PATH).size > 16 * 1024 * 1024) return [];
    const parsed = JSON.parse(readFileSync(NEWS_ARCHIVE_PATH, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, NEWS_ARCHIVE_MAX_ITEMS)
      .map(sanitizeStoredNewsItem)
      .filter((item): item is NewsContextItem => Boolean(item))
      .filter(isUsefulNewsItem)
      .sort(compareContextItems)
      .slice(0, NEWS_ARCHIVE_MAX_ITEMS);
  } catch {
    return [];
  }
}

function persistNewsArchive(snapshot: NewsContextItem[]): void {
  const payload = JSON.stringify(snapshot.slice(0, NEWS_ARCHIVE_MAX_ITEMS));
  archivePersistTail = archivePersistTail
    .catch(() => undefined)
    .then(async () => {
      const temp = `${NEWS_ARCHIVE_PATH}.${process.pid}.${Date.now()}.tmp`;
      try {
        await mkdir(path.dirname(NEWS_ARCHIVE_PATH), { recursive: true });
        await writeFile(temp, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await rename(temp, NEWS_ARCHIVE_PATH);
      } finally {
        await unlink(temp).catch(() => undefined);
      }
    })
    .catch(() => undefined);
}

function commitNewsArchive(currentItems: NewsContextItem[]): NewsContextItem[] {
  const cutoff = Date.now() - NEWS_ARCHIVE_RETENTION_MS;
  const seen = new Set<string>();
  archive = [...currentItems, ...archive]
    .filter((item) => item.ts !== null && item.ts >= cutoff && item.ts <= Date.now())
    .filter(isUsefulNewsItem)
    .map(refreshItemSignals)
    .sort(compareContextItems)
    .filter((item) => {
      const key = canonicalNewsKey(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, NEWS_ARCHIVE_MAX_ITEMS);

  if (Date.now() - archivePersistedAt >= 60_000) {
    archivePersistedAt = Date.now();
    persistNewsArchive(archive);
  }

  const undated = currentItems.filter((item) => item.ts === null);
  return [...archive, ...undated].sort(compareContextItems).slice(0, NEWS_ARCHIVE_MAX_ITEMS);
}

export async function getNewsContext(force = false): Promise<NewsContextPayload> {
  if (cache) {
    if (force || Date.now() - cache.fetchedAt >= CACHE_MS) void startRefresh().catch(() => undefined);
    return cache;
  }
  return startRefresh();
}

export function subscribeNewsContext(listener: (payload: NewsContextPayload) => void): () => void {
  subscribers.add(listener);
  if (cache) listener(cache);
  return () => subscribers.delete(listener);
}

export function newsContextStatus(): {
  fetchedAt: number | null;
  sources: number;
  live: number;
  delayed: number;
  errors: number;
  items: number;
  refreshing: boolean;
} {
  const sources = cache?.sources ?? [];
  return {
    fetchedAt: cache?.fetchedAt ?? null,
    sources: sources.length,
    live: sources.filter((source) => source.status === 'live').length,
    delayed: sources.filter((source) => source.status === 'delayed').length,
    errors: sources.filter((source) => source.status === 'error').length,
    items: cache?.items.length ?? archive.length,
    refreshing: inFlight !== null,
  };
}

export function refreshNewsContextNow(): Promise<NewsContextPayload> {
  return startRefresh();
}

function startRefresh(): Promise<NewsContextPayload> {
  if (!inFlight) {
    const refresh = refreshNewsContext()
      .then((payload) => {
        cache = payload;
        subscribers.forEach((listener) => {
          try { listener(payload); } catch { /* stream disconnected */ }
        });
        return payload;
      });
    inFlight = refresh;
    // Attach a rejection handler immediately, before any detached caller can
    // abandon the promise. Explicit callers still receive the original
    // rejection, while the internal cleanup branch can never become an
    // unhandled secondary rejection (the common `.finally()` footgun).
    void refresh.catch(() => undefined);
    void refresh.then(
      () => { if (inFlight === refresh) inFlight = null; },
      () => { if (inFlight === refresh) inFlight = null; },
    );
  }
  return inFlight;
}

async function refreshNewsContext(): Promise<NewsContextPayload> {
  const [primary, venue, protocol, issuer, tree, rss, lookonchain] = await Promise.all([
    fetchPrimarySources(),
    fetchVenueSources(),
    fetchProtocolSources(),
    fetchIssuerSources(),
    fetchTree(),
    fetchRssBundle(),
    fetchLookonchain(),
  ]);
  const seen = new Set<string>();
  // First-party and original-publisher rows win over relay copies.
  const currentItems = [...primary.items, ...venue.items, ...protocol.items, ...issuer.items, ...rss.items, ...lookonchain.items, ...tree.items]
    .filter((item) => {
      if (!isUsefulNewsItem(item)) return false;
      const key = canonicalNewsKey(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(compareContextItems)
    .slice(0, NEWS_ARCHIVE_MAX_ITEMS);
  const items = commitNewsArchive(currentItems);

  return {
    source: 'primary+venue+protocol+issuer+tree+rss+lookonchain',
    fetchedAt: Date.now(),
    items,
    sources: [...primary.sources, ...venue.sources, ...protocol.sources, ...issuer.sources, tree.source, ...rss.sources, lookonchain.source],
  };
}

async function fetchPrimarySources(): Promise<{ items: NewsContextItem[]; sources: NewsContextSource[] }> {
  return fetchOfficialSources(PRIMARY_SOURCES, 'primary', primarySourceCache, PRIMARY_DEFAULT_MIN_FETCH_MS, 180);
}

async function fetchVenueSources(): Promise<{ items: NewsContextItem[]; sources: NewsContextSource[] }> {
  return fetchOfficialSources(VENUE_SOURCES, 'venue', venueSourceCache, VENUE_DEFAULT_MIN_FETCH_MS, 160);
}

async function fetchProtocolSources(): Promise<{ items: NewsContextItem[]; sources: NewsContextSource[] }> {
  return fetchOfficialSources(PROTOCOL_SOURCES, 'protocol', protocolSourceCache, PROTOCOL_DEFAULT_MIN_FETCH_MS, 320);
}

async function fetchIssuerSources(): Promise<{ items: NewsContextItem[]; sources: NewsContextSource[] }> {
  return fetchOfficialSources(ISSUER_SOURCES, 'issuer', issuerSourceCache, ISSUER_DEFAULT_MIN_FETCH_MS, 80);
}

async function fetchOfficialSources(
  sources: OfficialSourceConfig[],
  channel: NewsContextChannel,
  sourceCache: Map<string, RssFetchResult & { fetchedAt: number }>,
  defaultMinFetchMs: number,
  maxItems: number,
): Promise<{ items: NewsContextItem[]; sources: NewsContextSource[] }> {
  const fetchedAt = Date.now();
  const settled = await mapWithConcurrency(
    sources,
    OFFICIAL_SOURCE_CONCURRENCY,
    (source) => fetchOfficialSource(source, fetchedAt, channel, sourceCache, defaultMinFetchMs),
  );
  const items = settled
    .flatMap((res) => res.items)
    .sort(compareContextItems)
    .slice(0, maxItems);
  return {
    items,
    sources: settled.map((res) => res.source),
  };
}

async function fetchOfficialSource(
  source: OfficialSourceConfig,
  fetchedAt: number,
  channel: NewsContextChannel,
  sourceCache: Map<string, RssFetchResult & { fetchedAt: number }>,
  defaultMinFetchMs: number,
): Promise<RssFetchResult> {
  const cached = sourceCache.get(source.key);
  const minFetchMs = source.minFetchMs ?? defaultMinFetchMs;
  if (cached && Date.now() - cached.fetchedAt < minFetchMs) {
    return {
      items: cached.items,
      source: {
        ...cached.source,
        status: cached.source.status === 'error' ? 'delayed' : cached.source.status,
        detail: `${source.detail} Cached ${sourceAgeLabel(cached.fetchedAt)}.`,
        fetchedAt: cached.source.fetchedAt,
        count: cached.items.length,
      },
    };
  }

  const endpoints = [
    ...(source.feeds ?? []).map((feed) => ({ kind: 'feed' as const, ...normalizeOfficialFeed(feed) })),
    ...(source.pages ?? []).map((page) => ({ kind: 'page' as const, ...page })),
    ...(source.jsons ?? []).map((json) => ({ kind: 'json' as const, ...json })),
  ];
  if (!endpoints.length) {
    return { items: [], source: sourceError(source.key, source.label, 'No official endpoints configured.', source.url, source.domain) };
  }

  const settled = await Promise.allSettled(endpoints.map(async (endpoint) => {
    if (endpoint.kind === 'feed') {
      const feed: FeedConfig = {
        key: source.key,
        label: endpoint.label ?? source.label,
        domain: endpoint.domain ?? source.domain,
        url: endpoint.url,
        includeKeywords: endpoint.includeKeywords,
      };
      const xml = await fetchText(endpoint.url, {
        headers: {
          Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
          Referer: source.url,
        },
      });
      return parseFeed(xml, feed, channel);
    }
    if (endpoint.kind === 'json') {
      const data = await fetchJson<unknown>(endpoint.url, {
        headers: {
          Accept: 'application/json, text/plain, */*',
          Referer: source.url,
        },
      });
      return parseOfficialJson(data, source, endpoint, channel);
    }
    const html = await fetchText(endpoint.url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,*/*',
        Referer: source.url,
      },
    });
    return parseOfficialPage(html, source, endpoint, channel);
  }));

  const errors = settled
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => errorMessage(result.reason));
  const seen = new Set<string>();
  const items = settled
    .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
    .filter((item) => {
      const key = `${normalizeKey(item.title)}:${item.ts ?? 0}`;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(compareContextItems)
    .slice(0, 64);

  if (!items.length && cached) {
    return {
      items: cached.items,
      source: {
        ...cached.source,
        status: 'delayed',
        detail: `Using latest cached rows; official refresh hit ${errors[0] ?? 'no rows'}.`,
        fetchedAt: cached.source.fetchedAt,
        count: cached.items.length,
      },
    };
  }

  const successCount = settled.filter((result) => result.status === 'fulfilled').length;
  const rowCount = settled.filter((result) => result.status === 'fulfilled' && result.value.length).length;
  const result: RssFetchResult = {
    items,
    source: {
      key: source.key,
      label: source.label,
      status: successCount ? 'live' : 'error',
      detail: items.length
        ? `${source.detail} ${rowCount}/${endpoints.length} endpoints returned rows.`
        : successCount
          ? `${source.detail} ${successCount}/${endpoints.length} endpoints reachable; no current rows.`
          : `${source.detail} No rows returned${errors.length ? `; ${errors[0]}` : '.'}`,
      fetchedAt,
      count: items.length,
      url: source.url,
      domain: source.domain,
    },
  };
  if (items.length || successCount) sourceCache.set(source.key, { ...result, fetchedAt });
  return result;
}

async function fetchTree(): Promise<{ items: NewsContextItem[]; source: NewsContextSource }> {
  const fetchedAt = Date.now();
  if (treeSourceCache && fetchedAt - treeSourceCache.fetchedAt < TREE_MIN_FETCH_MS) {
    return {
      items: treeSourceCache.items,
      source: {
        ...treeSourceCache.source,
        detail: `Rolling public history with lightweight live polling. Cached ${sourceAgeLabel(treeSourceCache.fetchedAt)}.`,
        fetchedAt: treeSourceCache.source.fetchedAt,
        count: treeSourceCache.items.length,
      },
    };
  }
  const refreshHistory = !treeSourceCache || fetchedAt - treeHistoryFetchedAt >= TREE_HISTORY_FETCH_MS;
  const endpoint = refreshHistory ? TREE_HISTORY_URL : TREE_URL;
  try {
    const data = await fetchJson<unknown[]>(endpoint, { headers: { Accept: 'application/json' } });
    const fresh = Array.isArray(data)
      ? data.slice(0, 5_000).map((row) => normalizeTree(row)).filter((row): row is NewsContextItem => Boolean(row)).filter(isUsefulNewsItem)
      : [];
    const seen = new Set<string>();
    const items = [...fresh, ...(treeSourceCache?.items ?? [])]
      .filter((item) => item.ts !== null && item.ts >= fetchedAt - NEWS_ARCHIVE_RETENTION_MS)
      .sort(compareContextItems)
      .filter((item) => {
        const key = canonicalNewsKey(item);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 5_000);
    if (refreshHistory) treeHistoryFetchedAt = fetchedAt;
    const result: RssFetchResult = {
      items,
      source: {
        key: 'tree',
        label: 'Tree Of Alpha Relay',
        status: 'delayed',
        detail: 'Rolling seven-day public history with a smaller live polling delta.',
        fetchedAt,
        count: items.length,
        url: TREE_URL,
        domain: 'treeofalpha.com',
      },
    };
    if (items.length) treeSourceCache = { ...result, fetchedAt };
    return result;
  } catch (err) {
    if (treeSourceCache) {
      return {
        items: treeSourceCache.items,
        source: {
          ...treeSourceCache.source,
          detail: `Using the retained Tree history; refresh hit ${errorMessage(err)}.`,
          fetchedAt: treeSourceCache.source.fetchedAt,
          count: treeSourceCache.items.length,
        },
      };
    }
    return { items: [], source: sourceError('tree', 'Tree Of Alpha Relay', err, endpoint, 'treeofalpha.com') };
  }
}

async function fetchLookonchain(): Promise<{ items: NewsContextItem[]; source: NewsContextSource }> {
  const fetchedAt = Date.now();
  if (lookonchainSourceCache && fetchedAt - lookonchainSourceCache.fetchedAt < LOOKONCHAIN_MIN_FETCH_MS) {
    return {
      items: lookonchainSourceCache.items,
      source: {
        ...lookonchainSourceCache.source,
        detail: `Public on-chain feed endpoint. Cached ${sourceAgeLabel(lookonchainSourceCache.fetchedAt)}.`,
        count: lookonchainSourceCache.items.length,
      },
    };
  }
  try {
    const text = await fetchText(LOOKONCHAIN_URL, {
      headers: {
	        Accept: 'application/json',
	        Referer: 'https://www.lookonchain.com/feeds',
	        'User-Agent': USER_AGENT,
	      },
    });
    const data = parseLooseJson<{ success?: string; time?: string; content?: unknown[] }>(text);
    const sourceNow = parseLookonchainDate(String(data.time ?? '')) ?? Date.now();
    const items = data.success === 'Y' && Array.isArray(data.content)
      ? data.content.slice(0, 24).map((row) => normalizeLookonchain(row, sourceNow)).filter((row): row is NewsContextItem => Boolean(row))
      : [];
    const result: RssFetchResult = {
      items,
      source: {
        key: 'lookonchain',
        label: 'Lookonchain',
        status: items.length ? 'live' : 'error',
	        detail: items.length ? 'Public on-chain feed endpoint.' : 'Endpoint returned no rows.',
	        fetchedAt,
	        count: items.length,
	        url: LOOKONCHAIN_URL,
	        domain: 'lookonchain.com',
	      },
    };
    if (items.length) lookonchainSourceCache = { ...result, fetchedAt };
    return result;
  } catch (err) {
	  if (lookonchainSourceCache) {
      return {
        items: lookonchainSourceCache.items,
        source: { ...lookonchainSourceCache.source, status: 'delayed', detail: `Using cached on-chain rows; refresh hit ${errorMessage(err)}.` },
      };
    }
	    return { items: [], source: sourceError('lookonchain', 'Lookonchain', err, LOOKONCHAIN_URL, 'lookonchain.com') };
  }
}

async function fetchRssBundle(): Promise<{ items: NewsContextItem[]; sources: NewsContextSource[] }> {
  const fetchedAt = Date.now();
  const settled = await mapWithConcurrency(RSS_FEEDS, RSS_SOURCE_CONCURRENCY, (feed) => fetchRssFeed(feed, fetchedAt));
  const items = settled
    .flatMap((res) => res.items)
    .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
    .slice(0, 6_000);
  return {
    items,
    sources: settled.map((res) => res.source),
  };
}

async function fetchRssFeed(feed: RssFeed, fetchedAt: number): Promise<RssFetchResult> {
  const cached = rssSourceCache.get(feed.key);
  const minFetchMs = feed.minFetchMs ?? RSS_DEFAULT_MIN_FETCH_MS;
  if (cached && minFetchMs && Date.now() - cached.fetchedAt < minFetchMs) {
    return {
      items: cached.items,
      source: {
        ...cached.source,
        status: 'live',
        detail: `${rssDetail(feed)} Cached ${sourceAgeLabel(cached.fetchedAt)}; publisher rate limit respected.`,
        fetchedAt: cached.source.fetchedAt,
        count: cached.items.length,
      },
    };
  }

  try {
    if (feed.pageParser) {
      const html = await fetchText(feed.url, {
        headers: {
          Accept: 'text/html,application/xhtml+xml,*/*',
          Referer: `https://${feed.domain}/`,
        },
      });
      const items = parseMediaPage(html, feed).slice(0, 80);
      const result: RssFetchResult = {
        items,
        source: {
          key: feed.key,
          label: feed.label,
          status: items.length ? 'live' : 'error',
          detail: items.length ? rssDetail(feed) : 'Page returned no eligible rows.',
          fetchedAt,
          count: items.length,
          url: feed.url,
          domain: feed.domain,
        },
      };
      if (items.length) rssSourceCache.set(feed.key, { ...result, fetchedAt });
      return result;
    }

    const xml = await fetchText(feed.url, {
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
        Referer: `https://${feed.domain}/`,
      },
    });
    const items = parseFeed(xml, feed).slice(0, 80);
    if (!items.length) {
      const fallback = await fetchRssFallback(feed, fetchedAt, 'Feed returned no rows.');
      if (fallback) return fallback;
    }
    const result: RssFetchResult = {
      items,
      source: {
        key: feed.key,
        label: feed.label,
        status: items.length ? 'live' : 'error',
        detail: items.length ? rssDetail(feed) : 'Feed returned no rows.',
        fetchedAt,
        count: items.length,
        url: feed.url,
        domain: feed.domain,
      },
    };
    if (items.length) rssSourceCache.set(feed.key, { ...result, fetchedAt });
    return result;
  } catch (err) {
    const fallback = await fetchRssFallback(feed, fetchedAt, errorMessage(err));
    if (fallback) return fallback;
    if (cached) {
      return {
        items: cached.items,
        source: {
          ...cached.source,
          status: 'delayed',
          detail: `Using latest cached rows; refresh hit ${errorMessage(err)}.`,
          fetchedAt: cached.source.fetchedAt,
          count: cached.items.length,
        },
      };
    }
    return { items: [], source: sourceError(feed.key, feed.label, err, feed.url, feed.domain) };
  }
}

async function fetchRssFallback(feed: RssFeed, fetchedAt: number, reason: string): Promise<RssFetchResult | null> {
  if (!feed.fallbackUrl) return null;
  try {
    const fallbackUrl = feed.fallbackUrl;
    const html = await fetchText(fallbackUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,*/*',
        Referer: `https://${feed.domain}/`,
      },
    });
    const items = parseFallbackPage(html, feed);
    if (!items.length) return null;
    const result: RssFetchResult = {
      items,
      source: {
        key: feed.key,
        label: feed.label,
        status: 'live',
        detail: `Official news page fallback. RSS feed returned ${reason}.`,
        fetchedAt,
        count: items.length,
        url: fallbackUrl,
        domain: feed.domain,
      },
    };
    rssSourceCache.set(feed.key, { ...result, fetchedAt });
    return result;
  } catch {
    return null;
  }
}

function normalizeTree(row: unknown): NewsContextItem | null {
  const data = row as Record<string, unknown>;
  const title = cleanRelayPrefix(cleanText(String(data.title ?? data.en ?? '')));
  if (!title || !looksPrimarilyEnglish(title)) return null;
  const ts = typeof data.time === 'number' ? data.time : null;
  const sourceName = cleanText(String(data.sourceName ?? data.source ?? 'Tree'));
  const rawSymbols = Array.isArray(data.symbols) ? data.symbols.map(String) : [];
  return buildItem({
    id: `tree:${String(data._id ?? ts ?? title)}`,
    title,
    summary: typeof data.en === 'string' && data.en !== title ? data.en : null,
	    url: typeof data.url === 'string' ? data.url : null,
	    source: sourceName,
	    sourceKey: 'tree',
	    sourceDomain: 'treeofalpha.com',
	    channel: 'tree',
	    ts,
    extraSymbols: rawSymbols,
  });
}

function normalizeLookonchain(row: unknown, sourceNow: number): NewsContextItem | null {
  const data = row as Record<string, unknown>;
  const title = cleanText(String(data.stitle ?? ''));
  if (!title) return null;
  const absoluteTs = parseLookonchainDate(String(data.dcreate_time ?? ''));
  const relativeTs = parseRelativeAge(String(data.times ?? ''), sourceNow);
  const ts = selectLookonchainTimestamp(absoluteTs, relativeTs);
  const url = data.nnewflash_id ? `https://www.lookonchain.com/feeds/${String(data.nnewflash_id)}` : (typeof data.surl === 'string' ? data.surl : null);
  return buildItem({
    id: `lookonchain:${String(data.nnewflash_id ?? title)}`,
    title,
    summary: cleanText(stripHtml(String(data.sabstract ?? ''))) || null,
	    url,
	    source: cleanText(String(data.ssource ?? 'Lookonchain')) || 'Lookonchain',
	    sourceKey: 'lookonchain',
	    sourceDomain: 'lookonchain.com',
	    channel: 'lookonchain',
	    ts,
  });
}

function normalizeOfficialFeed(feed: OfficialFeedEndpoint): { url: string; label?: string; domain?: string; includeKeywords?: string[] } {
  return typeof feed === 'string' ? { url: feed } : feed;
}

function parseFeed(xml: string, feed: FeedConfig, channel: NewsContextChannel = 'rss'): NewsContextItem[] {
  const maxBlocks = feed.includeKeywords?.length ? 160 : channel === 'primary' || channel === 'venue' ? 120 : 100;
  const rssItems = matchBlocks(xml, 'item', maxBlocks);
  const atomItems = rssItems.length ? [] : matchBlocks(xml, 'entry', maxBlocks);
  const feedBuildTs = parseDateMillis(readTag(xml, 'lastBuildDate') ?? readTag(xml, 'updated') ?? '');
  const rows = (rssItems.length ? rssItems : atomItems)
    .slice(0, maxBlocks)
    .map((block) => {
      const title = cleanText(readTag(block, 'title') ?? '');
      if (!title) return null;
      const link = absolutizeUrl(readTag(block, 'link') ?? readAttr(block, 'link', 'href') ?? feed.url, feed.url);
      const summary = cleanText(stripHtml(readTag(block, 'description') ?? readTag(block, 'summary') ?? readTag(block, 'content') ?? ''));
      if (feed.includeKeywords?.length && !matchesAnyKeyword(`${title} ${summary}`, feed.includeKeywords)) return null;
      const dateRaw = readTag(block, 'pubDate') ?? readTag(block, 'pubTime') ?? readTag(block, 'updated') ?? readTag(block, 'published') ?? '';
      const guid = readTag(block, 'guid') ?? link ?? title;
      return buildItem({
        id: `${channel}:${feed.key}:${guid}`,
        title,
        summary: summary || null,
        url: link,
        source: feed.label,
        sourceKey: feed.key,
        sourceDomain: feed.domain,
        channel,
        ts: parseDateMillis(dateRaw),
      });
    })
    .filter((row): row is NewsContextItem => Boolean(row));
  return guardFeedBuildTimestamps(rows, feedBuildTs);
}

function guardFeedBuildTimestamps(items: NewsContextItem[], feedBuildTs: number | null): NewsContextItem[] {
  if (!feedBuildTs || items.length < 3) return items;
  const now = Date.now();
  if (Math.abs(now - feedBuildTs) > 5 * 60_000) return items;
  const isBuildStamped = (item: NewsContextItem) => Boolean(item.ts && Math.abs(item.ts - feedBuildTs) <= 2_000);
  const buildStampedCount = items.filter(isBuildStamped).length;
  if (buildStampedCount < 3) return items;

  return items.map((item) => {
    if (!isBuildStamped(item)) return item;
    return { ...item, ts: null, timeLabel: 'No Time' };
  });
}

function parseOfficialPage(
  html: string,
  source: OfficialSourceConfig,
  page: OfficialPageEndpoint,
  channel: NewsContextChannel = 'primary',
): NewsContextItem[] {
  if (page.parser === 'treasury-press') return parseTreasuryPressPage(html, source, page.url, channel);
  if (page.parser === 'ofac-actions') return parseOfacActionsPage(html, source, page.url, channel);
  if (page.parser === 'boj-news') return parseBojNewsPage(html, source, page.url, channel);
  if (page.parser === 'nbs-releases') return parseNbsReleasesPage(html, source, page.url, channel);
  if (page.parser === 'pboc-home') return parsePbocHomePage(html, source, page.url, channel);
  if (page.parser === 'safe-home') return parseSafeHomePage(html, source, page.url, channel);
  if (page.parser === 'okx-announcements') return parseOkxAnnouncementsPage(html, source, page, channel);
  if (page.parser === 'okx-status') return parseOkxStatusPage(html, source, page, channel);
  if (page.parser === 'bybit-announcements') return parseBybitAnnouncementsPage(html, source, page, channel);
  if (page.parser === 'circle-blog') return parseCircleBlogPage(html, source, page, channel);
  if (page.parser === 'paxos-blog') return parsePaxosBlogPage(html, source, page, channel);
  if (page.parser === 'bitwise-insights') return parseBitwiseInsightsPage(html, source, page, channel);
  if (page.parser === '21shares-insights') return parse21SharesInsightsPage(html, source, page, channel);
  return [];
}

function parseOfficialJson(
  data: unknown,
  source: OfficialSourceConfig,
  endpoint: OfficialJsonEndpoint,
  channel: NewsContextChannel,
): NewsContextItem[] {
  if (endpoint.parser === 'coinbase-products') return parseCoinbaseProductsJson(data, source, endpoint, channel);
  if (endpoint.parser === 'upbit-announcements') return parseUpbitAnnouncementsJson(data, source, endpoint, channel);
  if (endpoint.parser === 'bithumb-notices') return parseBithumbNoticesJson(data, source, endpoint, channel);
  if (endpoint.parser === 'bybit-system-status') return parseBybitSystemStatusJson(data, source, endpoint, channel);
  return [];
}

function buildOfficialPageItem(source: OfficialSourceConfig, input: {
  idPart: string;
  title: string;
  url: string | null;
  ts: number | null;
  summary?: string | null;
  source?: string;
  sourceDomain?: string | null;
  channel?: NewsContextChannel;
}): NewsContextItem {
  const channel = input.channel ?? 'primary';
  return buildItem({
    id: `${channel}:${source.key}:page:${input.idPart}`,
    title: input.title,
    summary: input.summary ?? null,
    url: input.url,
    source: input.source ?? source.label,
    sourceKey: source.key,
    sourceDomain: input.sourceDomain ?? source.domain,
    channel,
    ts: input.ts,
  });
}

function parseCircleBlogPage(html: string, source: OfficialSourceConfig, page: OfficialPageEndpoint, channel: NewsContextChannel): NewsContextItem[] {
  const items: NewsContextItem[] = [];
  const seen = new Set<string>();
  const rows = html.matchAll(/"@type"\s*:\s*"BlogPosting"[\s\S]{0,900}?"headline"\s*:\s*"((?:\\.|[^"\\])+)"[\s\S]{0,900}?"url"\s*:\s*"([^"]+)"[\s\S]{0,900}?"datePublished"\s*:\s*"([^"]+)"/gi);
  for (const match of rows) {
    const title = decodeJsonText(match[1]);
    const url = absolutizeUrl(match[2], page.url);
    if (!title || seen.has(url)) continue;
    seen.add(url);
    items.push(buildOfficialPageItem(source, { idPart: url, title, url, ts: parseDateMillis(match[3]), channel }));
    if (items.length >= 12) break;
  }
  return items;
}

function parsePaxosBlogPage(html: string, source: OfficialSourceConfig, page: OfficialPageEndpoint, channel: NewsContextChannel): NewsContextItem[] {
  const items: NewsContextItem[] = [];
  const seen = new Set<string>();
  const rows = html.matchAll(/<a\b[^>]*href=["'](?:\.\/|\/)?(blog\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
  for (const match of rows) {
    const url = absolutizeUrl(`/${match[1]}`, page.url);
    const title = cleanText(stripHtml(match[2].match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? ''));
    const date = match[2].match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1] ?? '';
    if (!title || !date || seen.has(url)) continue;
    seen.add(url);
    items.push(buildOfficialPageItem(source, { idPart: url, title, url, ts: parseDateMillis(date), channel }));
    if (items.length >= 12) break;
  }
  return items;
}

function parseBitwiseInsightsPage(html: string, source: OfficialSourceConfig, page: OfficialPageEndpoint, channel: NewsContextChannel): NewsContextItem[] {
  const items: NewsContextItem[] = [];
  const seen = new Set<string>();
  const rows = html.matchAll(/<a\b[^>]*href=["'](\/crypto-market-insights\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
  for (const match of rows) {
    const url = absolutizeUrl(match[1], page.url);
    const title = cleanText(decodeXml(match[2].match(/<img\b[^>]*alt=["']([^"']+)["']/i)?.[1] ?? ''));
    if (!title || seen.has(url)) continue;
    const date = cleanText(stripHtml(match[2])).match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+\d{4}\b/i)?.[0] ?? '';
    seen.add(url);
    items.push(buildOfficialPageItem(source, { idPart: url, title, url, ts: parseNaturalDateMillis(date), channel }));
    if (items.length >= 12) break;
  }
  return items;
}

function parse21SharesInsightsPage(html: string, source: OfficialSourceConfig, page: OfficialPageEndpoint, channel: NewsContextChannel): NewsContextItem[] {
  const items: NewsContextItem[] = [];
  const seen = new Set<string>();
  const rows = html.matchAll(/<a\b[^>]*href=["'](\/en-(?:us|eu)\/insights\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
  for (const match of rows) {
    const url = absolutizeUrl(match[1], page.url);
    const title = cleanText(stripHtml(match[2].match(/<p\b[^>]*class=["'][^"']*text-emphasis[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? ''));
    if (!title || /article page link/i.test(title) || seen.has(url)) continue;
    const date = cleanText(stripHtml(match[2])).match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+\d{4}\b/i)?.[0] ?? '';
    seen.add(url);
    items.push(buildOfficialPageItem(source, { idPart: url, title, url, ts: parseNaturalDateMillis(date), channel }));
    if (items.length >= 12) break;
  }
  return items;
}

function parseTreasuryPressPage(html: string, source: OfficialSourceConfig, baseUrl: string, channel: NewsContextChannel): NewsContextItem[] {
  const items: NewsContextItem[] = [];
  const seen = new Set<string>();
  const rows = html.matchAll(/<time\b[^>]*datetime=["']([^"']+)["'][^>]*>[\s\S]{0,700}?<a\b[^>]*href=["']([^"']*\/news\/press-releases\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
  for (const match of rows) {
    const url = absolutizeUrl(match[2], baseUrl);
    const title = cleanText(stripHtml(match[3]));
    if (!title || seen.has(url)) continue;
    seen.add(url);
    items.push(buildOfficialPageItem(source, {
      idPart: url,
      title,
      url,
      ts: parseDateMillis(match[1]),
      channel,
    }));
    if (items.length >= 12) break;
  }
  return items;
}

function parseOfacActionsPage(html: string, source: OfficialSourceConfig, baseUrl: string, channel: NewsContextChannel): NewsContextItem[] {
  const items: NewsContextItem[] = [];
  const seen = new Set<string>();
  const rows = html.matchAll(/<a\b[^>]*href=["']([^"']*\/recent-actions\/\d[^"']*)["'][^>]*>([\s\S]*?)<\/a>[\s\S]{0,360}?([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/gi);
  for (const match of rows) {
    const url = absolutizeUrl(match[1], baseUrl);
    const title = cleanText(stripHtml(match[2]));
    if (!title || seen.has(url)) continue;
    seen.add(url);
    items.push(buildOfficialPageItem(source, {
      idPart: url,
      title,
      url,
      ts: parseNaturalDateMillis(match[3]),
      summary: 'OFAC recent action',
      channel,
    }));
    if (items.length >= 12) break;
  }
  return items;
}

function parseBojNewsPage(html: string, source: OfficialSourceConfig, baseUrl: string, channel: NewsContextChannel): NewsContextItem[] {
  const items: NewsContextItem[] = [];
  const rows = html.matchAll(/<time\b[^>]*datetime=["']([^"']+)["'][^>]*>[\s\S]*?<\/time>\s*<span\b[^>]*>([\s\S]*?)<\/span>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
  for (const match of rows) {
    const title = cleanText(stripHtml(match[4]));
    if (!title) continue;
    items.push(buildOfficialPageItem(source, {
      idPart: `${match[1]}:${match[3]}:${title}`,
      title,
      url: absolutizeUrl(match[3], baseUrl),
      ts: parseDateMillis(match[1]),
      summary: cleanText(stripHtml(match[2])) || null,
      channel,
    }));
    if (items.length >= 12) break;
  }
  return items;
}

function parseNbsReleasesPage(html: string, source: OfficialSourceConfig, baseUrl: string, channel: NewsContextChannel): NewsContextItem[] {
  const items: NewsContextItem[] = [];
  const rows = html.matchAll(/<a\b[^>]*title=["']([^"']+)["'][^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>\s*<span>(\d{4}-\d{2}-\d{2})<\/span>/gi);
  for (const match of rows) {
    const title = cleanText(stripHtml(match[1]).replace(/^\d+\.\s*/, ''));
    if (!title) continue;
    items.push(buildOfficialPageItem(source, {
      idPart: `${match[3]}:${match[2]}:${title}`,
      title,
      url: absolutizeUrl(match[2], baseUrl),
      ts: parseDateMillis(match[3]),
      summary: 'China NBS latest release',
      channel,
    }));
    if (items.length >= 12) break;
  }
  return items;
}

function parsePbocHomePage(html: string, source: OfficialSourceConfig, baseUrl: string, channel: NewsContextChannel): NewsContextItem[] {
  const items: NewsContextItem[] = [];
  const recent = html.slice(Math.max(0, html.indexOf('Recent Developments')));
  const rows = recent.matchAll(/<span\b[^>]*>\[(\d{4}-\d{2}-\d{2})\]<\/span>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*(?:title=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/a>/gi);
  for (const match of rows) {
    const title = cleanText(stripHtml(match[3] || match[4]));
    if (!title) continue;
    items.push(buildOfficialPageItem(source, {
      idPart: `${match[1]}:${match[2]}:${title}`,
      title,
      url: absolutizeUrl(match[2], baseUrl),
      ts: parseDateMillis(match[1]),
      summary: 'PBoC recent development',
      channel,
    }));
    if (items.length >= 12) break;
  }
  return items;
}

function parseSafeHomePage(html: string, source: OfficialSourceConfig, baseUrl: string, channel: NewsContextChannel): NewsContextItem[] {
  const items: NewsContextItem[] = [];
  const seen = new Set<string>();
  const rows = html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*(?:title=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/a>\s*(?:<\/dt>\s*)?<dd>(\d{4}-\d{2}-\d{2})<\/dd>/gi);
  for (const match of rows) {
    const url = absolutizeUrl(match[1], baseUrl);
    const title = cleanText(stripHtml(match[2] || match[3]));
    if (!title || seen.has(url)) continue;
    seen.add(url);
    items.push(buildOfficialPageItem(source, {
      idPart: `${match[4]}:${url}`,
      title,
      url,
      ts: parseDateMillis(match[4]),
      summary: title.includes('Reserve') || title.includes('Balance') || title.includes('External') ? 'SAFE data/statistics' : 'SAFE news',
      channel,
    }));
    if (items.length >= 12) break;
  }
  return items;
}

function parseOkxAnnouncementsPage(html: string, source: OfficialSourceConfig, page: OfficialPageEndpoint, channel: NewsContextChannel): NewsContextItem[] {
  const state = readJsonScript(html, 'appState') as Record<string, any> | null;
  const rows = state?.appContext?.initialProps?.sectionData?.articleList?.list;
  if (!Array.isArray(rows)) return [];
  return rows
    .slice(0, 12)
    .map((row) => {
      const title = cleanText(String(row?.title ?? ''));
      const slug = cleanText(String(row?.slug ?? row?.id ?? ''));
      if (!title || !slug) return null;
      const url = absolutizeUrl(`/help/${slug}`, page.url);
      return buildOfficialPageItem(source, {
        idPart: `${slug}:${row?.publishTime ?? ''}`,
        title,
        url,
        ts: typeof row?.publishTime === 'number' ? row.publishTime : parseDateMillis(String(row?.publishTime ?? '')),
        summary: okxSectionLabel(String(row?.sectionSlug ?? '')),
        source: page.label ?? source.label,
        sourceDomain: page.domain ?? source.domain,
        channel,
      });
    })
    .filter((row): row is NewsContextItem => Boolean(row));
}

function parseOkxStatusPage(html: string, source: OfficialSourceConfig, page: OfficialPageEndpoint, channel: NewsContextChannel): NewsContextItem[] {
  const items: NewsContextItem[] = [];
  const seen = new Set<string>();
  const links = html.matchAll(/<a\b[^>]*href=["']([^"']*\/help\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
  for (const match of links) {
    const block = match[2];
    const h3 = block.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
    const title = cleanText(stripHtml(h3?.[1] ?? ''));
    if (!title || !/\b(issue|service|status|maintenance|failure|upgrade)\b/i.test(title)) continue;
    const url = absolutizeUrl(match[1], page.url);
    if (seen.has(url)) continue;
    seen.add(url);
    const text = cleanText(stripHtml(block));
    const date = text.match(/\b[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\b/)?.[0] ?? '';
    items.push(buildOfficialPageItem(source, {
      idPart: url,
      title,
      url,
      ts: parseNaturalDateMillis(date),
      summary: 'OKX status issue history',
      source: page.label ?? 'OKX Status',
      sourceDomain: page.domain ?? 'okx.com',
      channel,
    }));
    if (items.length >= 8) break;
  }
  return items;
}

function parseBybitAnnouncementsPage(html: string, source: OfficialSourceConfig, page: OfficialPageEndpoint, channel: NewsContextChannel): NewsContextItem[] {
  const state = readJsonScript(html, '__NEXT_DATA__') as Record<string, any> | null;
  const rows = state?.props?.pageProps?.articleInitEntity?.list;
  if (!Array.isArray(rows)) return [];
  return rows
    .slice(0, 12)
    .map((row) => {
      const title = cleanText(String(row?.title ?? ''));
      if (!title) return null;
      const url = absolutizeUrl(String(row?.url ?? ''), page.url);
      const category = cleanText(String(row?.category?.title ?? ''));
      const topics = Array.isArray(row?.topics) ? row.topics.map((topic: unknown) => cleanText(String(topic))).filter(Boolean).slice(0, 3) : [];
      const summary = cleanText(String(row?.description ?? '')) || [category, ...topics].filter(Boolean).join(' · ') || null;
      const ts = secondsToMillis(row?.publish_time) ?? secondsToMillis(row?.date_timestamp) ?? secondsToMillis(row?.start_date_timestamp);
      return buildOfficialPageItem(source, {
        idPart: `${row?.objectID ?? row?.url ?? title}:${row?.publish_time ?? ''}`,
        title,
        url,
        ts,
        summary,
        source: page.label ?? source.label,
        sourceDomain: page.domain ?? source.domain,
        channel,
      });
    })
    .filter((row): row is NewsContextItem => Boolean(row));
}

function parseCoinbaseProductsJson(data: unknown, source: OfficialSourceConfig, endpoint: OfficialJsonEndpoint, channel: NewsContextChannel): NewsContextItem[] {
  if (!Array.isArray(data)) return [];
  return data
    .slice(0, 5_000)
    .map((row) => {
      const product = row as Record<string, unknown>;
      const id = cleanText(String(product.id ?? product.display_name ?? ''));
      if (!id) return null;
      const phase = coinbaseTradingPhase(product);
      if (!phase) return null;
      return buildOfficialPageItem(source, {
        idPart: `${id}:${phase}`,
        title: `Coinbase ${id} Trading Phase: ${phase}`,
        url: 'https://www.coinbase.com/exchange/asset-listings',
        ts: null,
        summary: cleanText(String(product.status_message ?? '')) || 'Official Coinbase Exchange product availability state',
        source: endpoint.label ?? source.label,
        sourceDomain: endpoint.domain ?? source.domain,
        channel,
      });
    })
    .filter((row): row is NewsContextItem => Boolean(row))
    .slice(0, 12);
}

function parseUpbitAnnouncementsJson(data: unknown, source: OfficialSourceConfig, endpoint: OfficialJsonEndpoint, channel: NewsContextChannel): NewsContextItem[] {
  const notices = (data as Record<string, any>)?.data?.notices;
  if (!Array.isArray(notices)) return [];
  return notices
    .slice(0, 12)
    .map((notice) => {
      const title = cleanText(String(notice?.title ?? ''));
      const id = String(notice?.id ?? notice?.uuid ?? title);
      if (!title) return null;
      return buildOfficialPageItem(source, {
        idPart: `upbit:${id}:${notice?.listed_at ?? ''}`,
        title,
        url: notice?.id ? `https://upbit.com/service_center/notice?id=${encodeURIComponent(String(notice.id))}` : source.url,
        ts: parseDateMillis(String(notice?.listed_at ?? notice?.first_listed_at ?? '')),
        summary: cleanText(String(notice?.category ?? 'Upbit notice')) || 'Upbit notice',
        source: endpoint.label ?? 'Upbit',
        sourceDomain: endpoint.domain ?? 'upbit.com',
        channel,
      });
    })
    .filter((row): row is NewsContextItem => Boolean(row));
}

function parseBithumbNoticesJson(data: unknown, source: OfficialSourceConfig, endpoint: OfficialJsonEndpoint, channel: NewsContextChannel): NewsContextItem[] {
  if (!Array.isArray(data)) return [];
  return data
    .slice(0, 12)
    .map((notice) => {
      const row = notice as Record<string, unknown>;
      const title = cleanText(String(row.title ?? ''));
      if (!title) return null;
      const categories = Array.isArray(row.categories) ? row.categories.map(String).map(cleanText).filter(Boolean).join(' · ') : 'Bithumb notice';
      const url = typeof row.pc_url === 'string' ? row.pc_url : source.url;
      return buildOfficialPageItem(source, {
        idPart: `bithumb:${url}:${row.published_at ?? ''}`,
        title,
        url,
        ts: parseDateWithZone(String(row.published_at ?? row.modified_at ?? ''), '+09:00'),
        summary: categories,
        source: endpoint.label ?? 'Bithumb',
        sourceDomain: endpoint.domain ?? 'bithumb.com',
        channel,
      });
    })
    .filter((row): row is NewsContextItem => Boolean(row));
}

function parseBybitSystemStatusJson(data: unknown, source: OfficialSourceConfig, endpoint: OfficialJsonEndpoint, channel: NewsContextChannel): NewsContextItem[] {
  const list = (data as Record<string, any>)?.result?.list;
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, 12)
    .map((entry) => {
      const title = cleanText(String(entry?.title ?? entry?.state ?? entry?.id ?? 'Bybit System Status'));
      if (!title) return null;
      return buildOfficialPageItem(source, {
        idPart: `bybit-system:${entry?.id ?? entry?.title ?? title}`,
        title: title.startsWith('Bybit') ? title : `Bybit ${title}`,
        url: 'https://announcements.bybit.com/en/?category=maintenance_updates',
        ts: parseDateMillis(String(entry?.beginTime ?? entry?.startTime ?? entry?.time ?? '')),
        summary: cleanText(String(entry?.desc ?? entry?.status ?? 'Official Bybit system status')) || 'Official Bybit system status',
        source: endpoint.label ?? 'Bybit System Status',
        sourceDomain: endpoint.domain ?? 'bybit.com',
        channel,
      });
    })
    .filter((row): row is NewsContextItem => Boolean(row));
}

function parseFallbackPage(html: string, feed: RssFeed): NewsContextItem[] {
  if (feed.key === 'cryptoslate') return parseCryptoSlateNewsPage(html, feed);
  return [];
}

function parseMediaPage(html: string, feed: RssFeed): NewsContextItem[] {
  if (feed.pageParser === 'ap-business') return parseApBusinessPage(html, feed);
  if (feed.pageParser === 'dl-news') return parseDlNewsPage(html, feed);
  if (feed.pageParser === 'kaiko-blog') return parseKaikoBlogPage(html, feed);
  return [];
}

function parseKaikoBlogPage(html: string, feed: RssFeed): NewsContextItem[] {
  const seen = new Set<string>();
  const items: NewsContextItem[] = [];
  const rows = html.matchAll(/<a\b[^>]*href=["'](\/resources\/(?!categories\/|guides\/?)[^"']+)["'][^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>[\s\S]{0,360}?<span\b[^>]*>([\s\S]*?)<\/span>/gi);
  for (const match of rows) {
    const url = absolutizeUrl(match[1], feed.url);
    const title = cleanText(stripHtml(match[2]));
    if (!title || seen.has(url)) continue;
    seen.add(url);
    items.push(buildItem({
      id: `rss:${feed.key}:page:${url}`,
      title,
      summary: 'Kaiko first-party crypto market structure research',
      url,
      source: feed.label,
      sourceKey: feed.key,
      sourceDomain: feed.domain,
      channel: 'rss',
      ts: null,
    }));
    if (items.length >= 8) break;
  }
  return items;
}

function parseApBusinessPage(html: string, feed: RssFeed): NewsContextItem[] {
  const seen = new Set<string>();
  const items: NewsContextItem[] = [];
  const rows = html.matchAll(/<div\b[^>]*class=["'][^"']*PagePromo[^"']*["'][^>]*data-gtm-region=["']([^"']+)["'][^>]*data-posted-date-timestamp=["'](\d+)["'][\s\S]*?<a\b[^>]*href=["']([^"']*\/article\/[^"']+)["']/gi);
  for (const match of rows) {
    const title = cleanText(match[1]);
    if (!isApBusinessHeadline(title)) continue;
    const url = absolutizeUrl(match[3], feed.url);
    if (seen.has(url)) continue;
    seen.add(url);
    const ts = Number(match[2]);
    items.push(buildItem({
      id: `rss:${feed.key}:page:${url}`,
      title,
      summary: 'AP Business page headline',
      url,
      source: feed.label,
      sourceKey: feed.key,
      sourceDomain: feed.domain,
      channel: 'rss',
      ts: Number.isFinite(ts) ? ts : null,
    }));
    if (items.length >= 8) break;
  }
  return items;
}

function parseDlNewsPage(html: string, feed: RssFeed): NewsContextItem[] {
  const seen = new Set<string>();
  const items: NewsContextItem[] = [];
  const rows = html.matchAll(/<a\b[^>]*class=["'][^"']*article-preview-image[^"']*["'][^>]*href=["']([^"']*\/articles\/[^"']+)["'][\s\S]{0,1200}?<img\b[^>]*alt=["']([^"']+)["']/gi);
  for (const match of rows) {
    const url = absolutizeUrl(match[1], feed.url);
    const title = cleanText(stripHtml(match[2]));
    if (!title || seen.has(url)) continue;
    seen.add(url);
    const nearbyText = cleanText(stripHtml(html.slice(match.index ?? 0, (match.index ?? 0) + 2600)));
    const relativeAge = nearbyText.match(/\b\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago\b/i)?.[0] ?? '';
    items.push(buildItem({
      id: `rss:${feed.key}:page:${url}`,
      title,
      summary: 'DL News official page headline',
      url,
      source: feed.label,
      sourceKey: feed.key,
      sourceDomain: feed.domain,
      channel: 'rss',
      ts: parseRelativeAge(relativeAge, Date.now()),
    }));
    if (items.length >= 8) break;
  }
  return items;
}

function parseCryptoSlateNewsPage(html: string, feed: RssFeed): NewsContextItem[] {
  const ignored = new Set([
    'news', 'feed', 'coins', 'predictions', 'crypto-laws', 'guides', 'reviews', 'directory',
    'market', 'regulation', 'macro', 'defi', 'etf', 'mining', 'trading', 'exchanges',
  ]);
  const seen = new Set<string>();
  const items: NewsContextItem[] = [];
  const links = html.matchAll(/<a\b[^>]*href=["'](https:\/\/cryptoslate\.com\/([^"'?#]+\/))["'][^>]*>([\s\S]*?)<\/a>/gi);
  for (const match of links) {
    const url = decodeXml(match[1]);
    const slug = decodeXml(match[2]).replace(/^\/+|\/+$/g, '');
    if (!slug || slug.includes('/') || ignored.has(slug) || seen.has(url)) continue;
    const title = cleanText(stripHtml(match[3]));
    if (!isCryptoSlateHeadline(title)) continue;
    const after = html.slice(match.index ?? 0, (match.index ?? 0) + 900);
    const naturalDate = after.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4}\b/i)?.[0] ?? '';
    seen.add(url);
    items.push(buildItem({
      id: `rss:${feed.key}:fallback:${url}`,
      title,
      summary: null,
      url,
      source: feed.label,
      sourceKey: feed.key,
      sourceDomain: feed.domain,
      channel: 'rss',
      ts: parseNaturalDateMillis(naturalDate),
    }));
    if (items.length >= 8) break;
  }
  return items;
}

function boundedIdentifier(value: unknown): string {
  const raw = String(value ?? '');
  const text = cleanText(raw.slice(0, 4_096));
  if (text.length <= 240) return text;
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 24);
  return `${text.slice(0, 210)}:${digest}`;
}

function safeExternalUrl(value: unknown, base?: string): string | null {
  if (typeof value !== 'string' || value.length > 4_096) return null;
  try {
    const url = base ? new URL(value, base) : new URL(value);
    if (url.protocol !== 'https:') return null;
    url.username = '';
    url.password = '';
    return url.toString().slice(0, 2_048);
  } catch {
    return null;
  }
}

function sanitizeStoredNewsItem(value: unknown): NewsContextItem | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<NewsContextItem>;
  const channels = new Set<NewsContextChannel>(['primary', 'venue', 'protocol', 'issuer', 'tree', 'rss', 'lookonchain']);
  const channel = channels.has(item.channel as NewsContextChannel) ? item.channel as NewsContextChannel : null;
  const title = typeof item.title === 'string' ? item.title : '';
  const sourceKey = typeof item.sourceKey === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(item.sourceKey)
    ? item.sourceKey
    : null;
  if (!channel || !sourceKey || !title.trim() || typeof item.id !== 'string') return null;
  return buildItem({
    id: item.id,
    title,
    summary: typeof item.summary === 'string' ? item.summary : null,
    url: typeof item.url === 'string' ? item.url : null,
    source: typeof item.source === 'string' ? item.source : sourceKey,
    sourceKey,
    sourceDomain: typeof item.sourceDomain === 'string' ? item.sourceDomain : null,
    channel,
    ts: typeof item.ts === 'number' && Number.isFinite(item.ts) ? item.ts : null,
    extraSymbols: Array.isArray(item.symbols) ? item.symbols.slice(0, 8).map(String) : [],
  });
}

function buildItem(input: {
  id: string;
  title: string;
  summary: string | null;
	url: string | null;
	source: string;
	sourceKey: string;
	sourceDomain: string | null;
	channel: NewsContextChannel;
  ts: number | null;
  extraSymbols?: string[];
}): NewsContextItem {
  const ts = normalizeTimestamp(input.ts);
  const title = cleanText(input.title).slice(0, 320);
  const summary = input.summary ? cleanText(input.summary).slice(0, 260) : null;
  const sourceKey = /^[a-z0-9][a-z0-9-]{0,63}$/.test(input.sourceKey) ? input.sourceKey : 'unknown';
  const source = cleanText(input.source).slice(0, 100) || 'Unknown';
  const domain = typeof input.sourceDomain === 'string' && /^(?:[a-z0-9-]+\.)*[a-z0-9-]{1,63}$/i.test(input.sourceDomain)
    ? input.sourceDomain.toLowerCase().slice(0, 253)
    : null;
  const text = `${title} ${summary ?? ''}`;
  const tags = classifyTags(text);
  const category = classifyNewsCategory({ sourceKey, channel: input.channel, title, tags });
  return {
    id: boundedIdentifier(input.id),
    url: safeExternalUrl(input.url),
    source,
    sourceKey,
    sourceDomain: domain,
    channel: input.channel,
    ts,
    title,
    summary,
    timeLabel: ts ? ageLabel(ts) : 'Undated',
    symbols: extractSymbols(text, input.extraSymbols),
    tags,
    category,
    tone: toneForTags(tags),
    impact: scoreNewsImpact({ sourceKey, channel: input.channel, title, tags }),
  };
}

function parseLooseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const repaired = text.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
    return JSON.parse(repaired) as T;
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const parseKey = `parse:${validateFetchUrl(url).toString()}`;
  const failure = bodyFailures.get(parseKey);
  if (failure && failure.until > Date.now()) throw new Error(failure.message);
  if (failure) bodyFailures.delete(parseKey);
  const text = await fetchBodyWithRetry(url, init, 'json');
  try {
    const parsed = JSON.parse(text) as T;
    bodyFailures.delete(parseKey);
    return parsed;
  } catch {
    const message = 'Invalid upstream JSON';
    boundedStateSet(bodyFailures, parseKey, { until: Date.now() + FETCH_FAILURE_TTL_MS, message });
    throw new Error(message);
  }
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const accept = new Headers(init?.headers).get('accept')?.toLowerCase() ?? '';
  const expected = accept.includes('json') && !accept.includes('html') && !accept.includes('xml')
    ? 'json'
    : accept.includes('html')
      ? 'html'
      : 'xml';
  return fetchBodyWithRetry(url, init, expected);
}

type ExpectedBody = 'json' | 'html' | 'xml';

/** Pure policy seam: this service performs public, read-only GETs only. */
export function normalizeNewsContextRequestMethod(method: unknown): 'GET' {
  if (method !== undefined && (typeof method !== 'string' || method.length === 0 || method.toUpperCase() !== 'GET')) {
    throw new Error('News context upstream requests are GET-only');
  }
  return 'GET';
}

function fetchHostAllowlist(): Set<string> {
  if (configuredFetchHosts) return configuredFetchHosts;
  const hosts = new Set<string>([
    'www.ft.com',
    'ft.com',
    'feeds.feedburner.com',
  ]);
  const add = (value: string | undefined): void => {
    if (!value) return;
    try {
      const url = new URL(value);
      if (url.protocol === 'https:') hosts.add(url.hostname.toLowerCase());
    } catch { /* static configuration is validated when fetched */ }
  };
  add(TREE_URL);
  add(TREE_HISTORY_URL);
  add(LOOKONCHAIN_URL);
  for (const source of [...PRIMARY_SOURCES, ...VENUE_SOURCES, ...PROTOCOL_SOURCES, ...ISSUER_SOURCES]) {
    add(source.url);
    for (const feed of source.feeds ?? []) add(normalizeOfficialFeed(feed).url);
    for (const page of source.pages ?? []) add(page.url);
    for (const json of source.jsons ?? []) add(json.url);
  }
  for (const feed of RSS_FEEDS) {
    add(feed.url);
    add(feed.fallbackUrl);
  }
  configuredFetchHosts = hosts;
  return hosts;
}

function validateFetchUrl(value: string, base?: URL): URL {
  const url = base ? new URL(value, base) : new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || !fetchHostAllowlist().has(url.hostname.toLowerCase())) {
    throw new Error('Disallowed upstream redirect');
  }
  return url;
}

function boundedStateSet<V>(map: Map<string, V>, key: string, value: V): void {
  if (!map.has(key) && map.size >= MAX_FETCH_STATE_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest) map.delete(oldest);
  }
  map.set(key, value);
}

function acceptsContentType(contentType: string, expected: ExpectedBody): boolean {
  const type = contentType.split(';', 1)[0].trim().toLowerCase();
  if (expected === 'json') return type === 'application/json' || type === 'text/json' || type.endsWith('+json') || type === 'text/plain';
  if (expected === 'html') return type === 'text/html' || type === 'application/xhtml+xml';
  return type === 'application/rss+xml'
    || type === 'application/atom+xml'
    || type === 'application/xml'
    || type === 'text/xml'
    || type === 'text/plain';
}

async function readBoundedText(res: Response): Promise<string> {
  const advertised = Number(res.headers.get('content-length'));
  if (Number.isFinite(advertised) && advertised > NEWS_BODY_LIMIT_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error('Upstream response too large');
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > NEWS_BODY_LIMIT_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('Upstream response too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

async function fetchBodyOnce(urlValue: string, init: RequestInit | undefined, expected: ExpectedBody): Promise<string> {
  const method = normalizeNewsContextRequestMethod((init as { method?: unknown } | undefined)?.method);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const onCallerAbort = (): void => ctrl.abort();
  init?.signal?.addEventListener('abort', onCallerAbort, { once: true });
  try {
    let current = validateFetchUrl(urlValue);
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const res = await fetch(current, {
        ...init,
        method,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Language': 'en-US,en;q=0.9',
          ...(init?.headers ?? {}),
        },
        redirect: 'manual',
        signal: ctrl.signal,
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!location || redirects === 3) throw new Error('Disallowed upstream redirect');
        current = validateFetchUrl(location, current);
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new Error(`Upstream HTTP ${res.status}`);
      }
      if (!acceptsContentType(res.headers.get('content-type') ?? '', expected)) {
        await res.body?.cancel().catch(() => undefined);
        throw new Error('Unexpected upstream content type');
      }
      return await readBoundedText(res);
    }
    throw new Error('Disallowed upstream redirect');
  } catch (err) {
    if (ctrl.signal.aborted) throw new Error('Upstream timeout');
    if (err instanceof Error && (/^Upstream HTTP \d{3}$/.test(err.message)
      || err.message === 'Upstream response too large'
      || err.message === 'Unexpected upstream content type'
      || err.message === 'Disallowed upstream redirect')) throw err;
    throw new Error('Upstream unavailable');
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener('abort', onCallerAbort);
  }
}

function retryableFetchError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : '';
  if (message === 'Upstream timeout' || message === 'Upstream unavailable') return true;
  const status = Number(message.match(/^Upstream HTTP (\d{3})$/)?.[1]);
  return status === 408 || status === 429 || status >= 500;
}

async function fetchBodyWithRetry(urlValue: string, init: RequestInit | undefined, expected: ExpectedBody): Promise<string> {
  // Reject before URL/cache/single-flight handling so a hostile method cannot
  // join an already-running GET or create policy state without owner approval.
  normalizeNewsContextRequestMethod((init as { method?: unknown } | undefined)?.method);
  const url = validateFetchUrl(urlValue);
  const accept = new Headers(init?.headers).get('accept') ?? '';
  const key = `${expected}:${url.toString()}:${accept.slice(0, 256)}`;
  const failure = bodyFailures.get(key);
  if (failure && failure.until > Date.now()) throw new Error(failure.message);
  if (failure) bodyFailures.delete(key);
  const existing = bodyInFlight.get(key);
  if (existing) return existing;

  const work = (async (): Promise<string> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const body = await fetchBodyOnce(url.toString(), init, expected);
        bodyFailures.delete(key);
        return body;
      } catch (err) {
        lastErr = err;
        if (!retryableFetchError(err) || attempt === 1) break;
        await sleep(350 * (attempt + 1));
      }
    }
    const message = errorMessage(lastErr);
    boundedStateSet(bodyFailures, key, { until: Date.now() + FETCH_FAILURE_TTL_MS, message });
    throw new Error(message);
  })();
  boundedStateSet(bodyInFlight, key, work);
  try {
    return await work;
  } finally {
    bodyInFlight.delete(key);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sourceError(key: string, label: string, err: unknown, url: string | null = null, domain: string | null = null): NewsContextSource {
  return {
    key,
    label,
    status: 'error',
    detail: errorMessage(err),
    fetchedAt: null,
    count: 0,
    url,
    domain,
  };
}

function rssDetail(feed: RssFeed): string {
  if (feed.pageParser) {
    return feed.minFetchMs
      ? 'Official public page headline source. Publisher limit: <=1 request / 3 minutes.'
      : 'Official public page headline source.';
  }
  return feed.minFetchMs
    ? 'Official RSS feed. Publisher limit: <=1 request / 3 minutes.'
    : 'Official RSS feed.';
}

function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  if (/^Upstream HTTP \d{3}$/.test(message)) return message;
  if (message === 'Upstream timeout'
    || message === 'Upstream response too large'
    || message === 'Unexpected upstream content type'
    || message === 'Disallowed upstream redirect'
    || message === 'Invalid upstream JSON') return message;
  return 'Upstream unavailable';
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function sourceAgeLabel(ts: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1_000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function compareContextItems(a: NewsContextItem, b: NewsContextItem): number {
  const byTime = (b.ts ?? 0) - (a.ts ?? 0);
  if (byTime !== 0) return byTime;
  if (a.channel !== b.channel) return channelRank(a.channel) - channelRank(b.channel);
  return a.id.localeCompare(b.id);
}

function channelRank(channel: NewsContextChannel): number {
  if (channel === 'primary') return 0;
  if (channel === 'venue') return 1;
  if (channel === 'protocol') return 2;
  if (channel === 'issuer') return 3;
  if (channel === 'tree') return 4;
  if (channel === 'lookonchain') return 5;
  return 6;
}

function classifyTags(text: string): string[] {
  const lower = text.toLowerCase();
  const tags: string[] = [];
  if (/\b(binance|coinbase|kraken|bybit|okx|upbit|bithumb|deribit|cme|globex)\b|\b(?:crypto|digital asset|stock) exchange\b|\btrading venue\b|\bexchange (?:listing|delisting|outage|maintenance)\b/.test(lower)) tags.push('Exchange');
  if (/\b(listing|lists|listed|launchpool|launchpad|perpetual|trading pair|airdrop|hodler|futures|options)\b/.test(lower)) tags.push('Listing');
  if (/\b(delist|delists|delisted|delisting|removal of .*trading pairs?|cease support|monitoring tag|trading support end)\b|거래지원 종료|거래유의/.test(lower)) tags.push('Delisting');
  if (/\b(api|websocket|endpoint|request weight|maintenance|upgrade|suspend(?:ed|sion)?|deposit|withdrawal|outage|incident|service issue)\b|점검|입출금/.test(lower)) tags.push('Ops');
  if (/\b(whale|wallet|transfer(?:red)?|burn(?:ed)?|bought|sold|deposited|withdrew|smart money|on-chain|onchain|netflow|inflow|outflow)\b/.test(lower)) tags.push('On-Chain');
  if (/\b(hack(?:ed)?|exploit(?:ed)?|breach(?:ed)?|cyberattack|phishing|stolen|drain(?:ed)?|vulnerability|security incident)\b/.test(lower)) tags.push('Security');
  if (/\b(release|client|node|validator|version|upgrade|hard fork|soft fork|mainnet|testnet|consensus|execution layer|beacon|github)\b/.test(lower)) tags.push('Release');
  if (/\b(governance|dao|delegate|forum)\b|\b(?:protocol|token|chain|on-chain) (?:proposal|vote)\b|\bproposal #?\d+\b/.test(lower)) tags.push('Governance');
  if (/\b(stablecoin|stable coin|usdt|usdc|pyusd|usds|fdusd|depeg|reserve|redemption|attestation)\b/.test(lower)) tags.push('Stablecoin');
  if (/\b(fed|fomc|bls|bea|cpi|ppi|pce|jolts|inflation|payroll|unemployment|rate|rates|gdp|employment|jobs|treasury|ofac|ecb|boe|boj|pboc|safe|fx reserve|yield|tariff|iran|strike|strikes|war)\b/.test(lower) || /\b(u\.s\.|us)\s+treasury\b/.test(lower)) tags.push('Macro');
  if (/\b(etf|sec|cftc|lawsuit|court|regulator|regulation|approval|enforcement|litigation|sanction|general license|trading suspension|legislation|bill|law)\b/.test(lower)) tags.push('Policy');
  if (/\b(ibit|fbtc|gbtc|bitb|arkb|ezbc|hodl|spot bitcoin etf|spot ether etf|bitcoin etf|ether etf)\b/.test(lower)) tags.push('ETF');
  if (!tags.length) tags.push('Market');
  return tags.slice(0, 4);
}

export function classifyNewsCategory(item: Pick<NewsContextItem, 'sourceKey' | 'channel' | 'title' | 'tags'>): NewsCategory {
  const key = item.sourceKey;
  const title = item.title.toLowerCase();
  const tags = new Set(item.tags);
  const cryptoTerms = /\b(bitcoin|btc|ethereum|eth|crypto|token|stablecoin|blockchain|defi|web3|nft|solana|xrp|dogecoin|altcoin)\b/.test(title);
  const exchangeEntity = /\b(binance|coinbase|kraken|bybit|okx|upbit|bithumb|deribit|bitmex|crypto\.com)\b/.test(title);
  const policyTerms = /\b(sec|cftc|fca|esma|ofac|regulator|regulation|lawsuit|court|enforcement|legislation|bill|law|license|sanction|approval|ban)\b/.test(title);
  const macroTerms = /\b(fed|fomc|central bank|inflation|cpi|ppi|pce|gdp|payroll|unemployment|interest rate|rate decision|treasury|bond yield|ecb|boe|boj|pboc|tariff|fx|dollar|oil)\b/.test(title);

  if (tags.has('Security')) return 'Security';
  if (item.channel === 'venue' || VENUE_KEYS.has(key) || exchangeEntity || tags.has('Exchange') || tags.has('Delisting')) return 'Exchange';
  if (REGULATORY_KEYS.has(key) || policyTerms || tags.has('Policy')) return 'Regulation';
  if ((OFFICIAL_MACRO_KEYS.has(key) && !REGULATORY_KEYS.has(key)) || macroTerms || tags.has('Macro')) return 'Macro';
  if (tags.has('On-Chain')) return 'On-Chain';
  if (item.channel === 'protocol' || tags.has('Release') || tags.has('Governance')) return 'Protocol';
  if (item.channel === 'issuer' || CRYPTO_EDITORIAL_KEYS.has(key) || cryptoTerms || tags.has('Stablecoin') || tags.has('ETF')) return 'Crypto';
  return 'Markets';
}

function toneForTags(tags: string[]): NewsContextTone {
  if (tags.some((tag) => tag === 'Delisting' || tag === 'Security' || tag === 'Macro')) return 'bad';
  if (tags.some((tag) => tag === 'Ops' || tag === 'Policy' || tag === 'On-Chain' || tag === 'Release' || tag === 'Governance' || tag === 'Stablecoin' || tag === 'ETF')) return 'warn';
  if (tags.some((tag) => tag === 'Listing' || tag === 'Exchange')) return 'ok';
  return 'idle';
}

export function scoreNewsImpact(item: Pick<NewsContextItem, 'sourceKey' | 'channel' | 'title' | 'tags'>): 1 | 2 | 3 {
  const key = item.sourceKey;
  const title = item.title.toLowerCase();
  const category = classifyNewsCategory(item);
  const critical = /\b(hack(?:ed)?|exploit(?:ed)?|breach(?:ed)?|stolen|drain(?:ed)?|depeg|bankruptcy|insolven(?:t|cy)|trading suspension|withdrawal halt|bridge pause|chain halt|service outage|emergency pause)\b/.test(title);
  const decisiveMacro = /\b(fomc|interest rate decision|rate decision|cpi|consumer price index|pce|ppi|payroll|employment situation|unemployment report|gdp|monetary policy (?:decision|statement|report)|central bank decision)\b/.test(title);
  const regulatoryAction = /\b(approve[sd]?|reject[sd]?|pass(?:es|ed)?|sign(?:s|ed)?|ban(?:s|ned)?|charges?|sues?|lawsuit|court ruling|final rule|enforcement action|license[sd]?|settlement|sanction[sd]?)\b/.test(title)
    && /\b(sec|cftc|fca|esma|ofac|regulator|government|court|state|parliament|senate|congress|occ|crypto|bitcoin|etf|stablecoin|token)\b/.test(title);
  const venueStructure = (item.channel === 'venue' || VENUE_KEYS.has(key) || category === 'Exchange')
    && /\b(listing|delisting|trading support|perpetual contract|margin pair|leverage (?:tier|limit)|network suspension|deposit suspension|withdrawal suspension|maintenance|tick size|removal of .*trading pairs?)\b/.test(title);
  const issuerStructure = /\b(stablecoin|reserve report|redemption|attestation|etf approval|fund launch|custody approval)\b/.test(title);
  const marketShock = /\b(surge[sd]?|jump[sd]?|plunge[sd]?|tumble[sd]?|crash(?:es|ed)?|liquidations?|record inflow|record outflow)\b/.test(title)
    && /\b\d+(?:\.\d+)?%\b|\$\s?\d/.test(title);
  const materialOnChain = /\b(whale|wallet|transfer(?:red)?|inflow|outflow|burn(?:ed)?|liquidat(?:ed|ion))\b/.test(title)
    && /\$\s?\d|\b\d+(?:\.\d+)?\s?(?:million|billion|m|bn)\b/.test(title);
  const corporateMaterial = /\b(chief executive|ceo|cfo|chief legal officer|steps? down|resigns?|acquires?|acquisition|merger|funding round|raises? \$|files? for (?:ipo|bankruptcy))\b/.test(title);
  const capitalMarketMaterial = /\b(ipo|offering|rights issue|bond sale|debt raise|raises?|raised)\b/.test(title)
    && /\$\s?\d|\b\d+(?:\.\d+)?\s?(?:million|billion|m|bn)\b/.test(title);
  const geopolitical = /\b(war|missile|airstrike|strikes? against|invasion|ceasefire|sanctions?)\b/.test(title);
  const majorEntity = /\b(federal reserve|fed|sec|cftc|ecb|boj|pboc|tether|circle|blackrock|grayscale)\b/.test(title);
  const largeScale = /\$\s?\d+(?:\.\d+)?\s?(?:billion|bn)\b|\$\s?(?:[1-9]\d{2,})(?:\.\d+)?\s?(?:million|m)\b/.test(title);
  const lowSignal = /\b(opinion|explainer|what happened|price prediction|could|may|might|why |here'?s what|roundup|sponsored|hiring|job opening)\b/.test(title);
  const routineRelease = item.channel === 'protocol' && /\b(?:ci|nightly|version|v?\d+\.\d+\.\d+|release candidate)\b/.test(title);

  if (critical) return 3;

  let score = 0;
  if (OFFICIAL_MACRO_KEYS.has(key) || item.channel === 'venue' || item.channel === 'issuer') score += 2;
  else if (item.channel === 'primary' || item.channel === 'protocol' || TRUSTED_EDITORIAL_KEYS.has(key)) score += 1;

  if (decisiveMacro) score += 3;
  if (regulatoryAction) score += 3;
  if (venueStructure) score += 3;
  if (issuerStructure) score += 2;
  if (marketShock) score += 2;
  if (materialOnChain) score += 1;
  if (corporateMaterial) score += 1;
  if (capitalMarketMaterial) score += 2;
  if (geopolitical) score += 2;
  if (majorEntity) score += 1;
  if (largeScale) score += 1;
  if (category === 'Macro' || category === 'Regulation' || category === 'Exchange' || category === 'On-Chain') score += 1;
  if (lowSignal) score -= 1;
  if (routineRelease) score = Math.min(score, 1);

  if (score >= 4) return 3;
  if (score >= 2) return 2;
  return 1;
}

function refreshItemSignals(item: NewsContextItem): NewsContextItem {
  return sanitizeStoredNewsItem(item) ?? item;
}

function extractSymbols(text: string, extra: string[] = []): string[] {
  const found = new Set<string>();
  for (const raw of extra) {
    const sym = raw.replace(/[_/-].*$/, '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (sym) found.add(sym);
  }
  for (const m of text.matchAll(/[$#]([A-Za-z0-9]{2,12})\b/g)) {
    found.add(m[1].toUpperCase());
  }
  for (const m of text.matchAll(/\b(BTC|ETH|SOL|BNB|XRP|DOGE|ARB|OP|SUI|USD1|WLFI|USDT|USDC|HYPE|PEPE|SHIB|MSTR)\b/gi)) {
    found.add(m[1].toUpperCase());
  }
  return Array.from(found).filter((sym) => COMMON_SYMBOLS.has(sym) || sym.length >= 3).slice(0, 8);
}

function matchBlocks(xml: string, tag: string, limit = 160): string[] {
  const out: string[] = [];
  const pattern = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi');
  let match: RegExpExecArray | null;
  while (out.length < limit && (match = pattern.exec(xml))) out.push(match[0]);
  return out;
}

function readTag(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? decodeXml(m[1]) : null;
}

function readAttr(block: string, tag: string, attr: string): string | null {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*\\s${attr}=["']([^"']+)["'][^>]*>`, 'i'));
  return m ? decodeXml(m[1]) : null;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}

function cleanText(value: string): string {
  return decodeXml(value).replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\s+/g, ' ').trim();
}

function matchesAnyKeyword(value: string, keywords: string[]): boolean {
  const lower = value.toLowerCase();
  return keywords.some((keyword) => {
    const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(lower);
  });
}

function readJsonScript(html: string, id: string): unknown | null {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<script\\b[^>]*id=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/script>`, 'i'));
  if (!match) return null;
  try {
    return JSON.parse(decodeXml(match[1]).trim());
  } catch {
    return null;
  }
}

function okxSectionLabel(slug: string): string | null {
  const labels: Record<string, string> = {
    'announcements-new-listings': 'OKX new listing',
    'announcements-delistings': 'OKX delisting',
    'announcements-trading-updates': 'OKX trading update',
    'announcements-deposit-withdrawal-suspension-resumption': 'OKX deposit/withdrawal update',
    'announcements-web3': 'OKX Web3 update',
  };
  return labels[slug] ?? null;
}

function coinbaseTradingPhase(product: Record<string, unknown>): string | null {
  const status = cleanText(String(product.status ?? '')).toLowerCase();
  const statusMessage = cleanText(String(product.status_message ?? ''));
  if (Boolean(product.trading_disabled)) return 'Trading Disabled';
  if (Boolean(product.cancel_only)) return 'Cancel Only';
  if (Boolean(product.limit_only)) return 'Limit Only';
  if (Boolean(product.post_only)) return 'Post Only';
  if (Boolean(product.auction_mode)) return 'Auction Mode';
  if (status && status !== 'online') return status.replace(/\b\w/g, (char) => char.toUpperCase());
  if (statusMessage) return statusMessage;
  return null;
}

function secondsToMillis(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric < 20_000_000_000 ? numeric * 1_000 : numeric;
}

function absolutizeUrl(value: string | null, base: string): string {
  const raw = cleanText(value ?? '').slice(0, 4_096);
  return safeExternalUrl(raw || base, base) ?? safeExternalUrl(base) ?? '';
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(Number.parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));
}

function parseDateMillis(value: string): number | null {
  if (!value) return null;
  const normalized = value.includes(' ') && !value.includes('T') ? value.replace(' ', 'T') : value;
  const ts = Date.parse(normalized);
  return Number.isFinite(ts) ? ts : null;
}

function parseNaturalDateMillis(value: string): number | null {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

function parseDateWithZone(value: string, zone: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.includes(' ') && !trimmed.includes('T') ? trimmed.replace(' ', 'T') : trimmed;
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}${zone}`;
  const ts = Date.parse(withZone);
  return Number.isFinite(ts) ? ts : null;
}

function isCryptoSlateHeadline(title: string): boolean {
  if (title.length < 32 || title.length > 220) return false;
  if (!/[a-z]/.test(title) || !/\s/.test(title)) return false;
  return !/^(open|view|browse|follow|explore|latest|section navigation|asset coverage|topic coverage)\b/i.test(title);
}

function isApBusinessHeadline(title: string): boolean {
  if (title.length < 24 || title.length > 220) return false;
  return /\b(market|markets|stock|stocks|shares|wall street|investor|investors|economy|economic|inflation|fed|federal reserve|rates|oil|bank|banks|business|company|companies|earnings|finance|financial|loan|loans|tariff|trade|ai)\b/i.test(title);
}

function parseLookonchainDate(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.includes(' ') && !trimmed.includes('T') ? trimmed.replace(' ', 'T') : trimmed;
  const withSourceZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(normalized)
    ? `${normalized}+08:00`
    : normalized;
  const ts = Date.parse(withSourceZone);
  return Number.isFinite(ts) ? ts : null;
}

function parseRelativeAge(value: string, baseTs: number): number | null {
  const lower = value.trim().toLowerCase();
  if (!lower) return null;
  if (lower === 'now' || lower === 'just now') return baseTs;
  const m = lower.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/);
  if (!m) return null;
  const qty = Number(m[1]);
  const unit = m[2];
  if (!Number.isFinite(qty)) return null;
  const unitMs: Record<string, number> = {
    second: 1_000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
    month: 30 * 86_400_000,
    year: 365 * 86_400_000,
  };
  return baseTs - qty * unitMs[unit];
}

function selectLookonchainTimestamp(absoluteTs: number | null, relativeTs: number | null): number | null {
  const now = Date.now();
  if (absoluteTs && absoluteTs <= now + 2 * 60_000) return absoluteTs;
  if (relativeTs && relativeTs <= now + 2 * 60_000) return relativeTs;
  return absoluteTs ?? relativeTs;
}

function normalizeTimestamp(ts: number | null): number | null {
  if (!ts || !Number.isFinite(ts)) return null;
  const now = Date.now();
  if (ts > now + 5 * 60_000) return null;
  return ts > now ? now : ts;
}

function ageLabel(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const seconds = Math.floor(diff / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function normalizeKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 180);
}

function decodeJsonText(value: string): string {
  try {
    return cleanText(JSON.parse(`"${value}"`) as string);
  } catch {
    return cleanText(value);
  }
}

function cleanRelayPrefix(title: string): string {
  return title
    .replace(/^finance feeds?\s*[:\-–—]\s*/i, '')
    .replace(/^(?:decrypt|cointelegraph|the block|coindesk|blockworks|reuters|bloomberg|wsj|cnbc)\s*[:\-–—]\s*/i, '')
    .trim();
}

function looksPrimarilyEnglish(text: string): boolean {
  const letters = text.match(/[A-Za-z]/g)?.length ?? 0;
  const nonLatin = text.match(/[\u0400-\u04ff\u0600-\u06ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g)?.length ?? 0;
  return letters >= 12 && letters >= nonLatin * 2;
}

function canonicalNewsKey(item: NewsContextItem): string {
  const title = cleanRelayPrefix(item.title)
    .replace(/\b(?:breaking|update|exclusive)\b\s*[:\-–—]?\s*/gi, '')
    .replace(/\s+(?:via|from)\s+@[a-z0-9_]+$/i, '');
  return normalizeKey(title).slice(0, 150);
}

function isUsefulNewsItem(item: NewsContextItem): boolean {
  if (item.channel !== 'tree') return true;
  const text = `${item.title} ${item.summary ?? ''}`.toLowerCase();
  if (/^finance feeds?\b/i.test(item.title)) return false;
  // The relay is valuable for speed, but it can occasionally surface a
  // keyword-matched tabloid story. Keep the tape market-grade instead of
  // letting breadth alone decide what reaches the operator.
  if (/\b(?:dailymail|thesun|mirror|express|nypost)\.(?:com|co\.uk)\b/i.test(item.url ?? '')) return false;
  return /\b(bitcoin|btc|ethereum|eth|crypto|token|stablecoin|blockchain|defi|exchange|binance|coinbase|kraken|bybit|okx|sec|cftc|fed|ecb|boj|rate|inflation|cpi|ppi|payroll|jobs|gdp|treasury|bond|yield|oil|gold|dollar|market|futures|options|nasdaq|s&p|dow|hack|exploit|listing|delist|wallet|on[ -]?chain)\b/.test(text);
}
