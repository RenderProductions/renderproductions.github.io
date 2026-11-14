// Who answers each kind of session: button presses, and typed answers where the kind takes them.
import type { Session } from '../core/sessions';
import * as shift from '../work/shift';
import { onWipeButton } from './admin';
import { onAchievementsButton } from './achievements';
import { onLeaderboardButton } from './social';
import { onShopButton } from './shop';
import { casinoHandlers } from './casino';
import { onLoanButton } from './loans';
import { onBrokerButton } from './schemes';
import { onBus } from './extras';
import { onHeistButton } from './heists';
import { onHelpButton } from './general';
import { onQuitButton, onStrikeButton } from './work';
import type { Ctx, ReplyObject, SessionReply } from './types';

export interface SessionHandler {
  onButton(ctx: Ctx, s: Session<any>, value: string): SessionReply;
  /** Typed answers in the session's channel (optional). Return null to ignore the message. */
  onText?(ctx: Ctx, s: Session<any>, text: string): ReplyObject | null;
}

export const handlers: Record<string, SessionHandler> = {
  [shift.KIND]: { onButton: shift.onButton, onText: shift.onText },
  quit: { onButton: onQuitButton },
  strike: { onButton: onStrikeButton },
  wipe: { onButton: onWipeButton },
  leaderboard: { onButton: onLeaderboardButton },
  achievements: { onButton: onAchievementsButton },
  shop: { onButton: onShopButton },
  loan: { onButton: onLoanButton },
  broker: { onButton: onBrokerButton },
  heist: { onButton: onHeistButton },
  help: { onButton: onHelpButton },
  'casino.bus': { onButton: onBus as SessionHandler['onButton'] },
  ...Object.fromEntries(Object.entries(casinoHandlers).map(([k, fn]) => [k, { onButton: fn as SessionHandler['onButton'] }]))
};
