// A typed doorway to the price engine (engine/engine.js). Only the parts the bot reads are typed;
// the engine's output is the same prices.json format the site already understands.

export interface EngineCompany {
  id: string;
  name: string;
  description: string;
  price: number;
  change: number;
  status: string;
  wipes: number;
  history: number[];
  start?: number;
}

export interface MarketData {
  updated: string;
  market: { status: 'open' | 'after-hours' | 'closed' | string; open: boolean; halted: boolean; text: string; nextChange: string | null };
  prices: Record<string, number>;
  changes: Record<string, number>;
  statuses: Record<string, string>;
  statusText: Record<string, string>;
  tradable: Record<string, boolean>;
  wipes: Record<string, number>;
  names: Record<string, string>;
  sparks: Record<string, string>;
  dividends: Record<string, number>;
  crashText: string;
  boostText: string;
  headlineText?: string;
  companies: EngineCompany[];
  [key: string]: unknown;
}

export type MarketPost = { kind: string; [key: string]: unknown };

export interface TickResult { skip?: boolean; data: MarketData; state: unknown; posts: MarketPost[] }

interface EngineModule {
  tick(input: { old?: Partial<MarketData>; state?: unknown; now?: number; rand?: () => number; nudges?: Record<string, number> }): TickResult;
  configure(settings: { crash?: unknown; boost?: unknown }): void;
  COMPANIES: (EngineCompany & { start: number })[];
  TICK_MS: number;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const ENGINE: EngineModule = require('./engine/engine.js');
export const TICK_MS = ENGINE.TICK_MS;
