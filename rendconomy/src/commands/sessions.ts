// Who answers each kind of session: button presses, and typed answers where the kind takes them.
import type { Session } from '../core/sessions';
import * as shift from '../work/shift';
import { onWipeButton } from './admin';
import { onAchievementsButton } from './achievements';
import { onLeaderboardButton } from './social';
import { onQuitButton } from './work';
import type { Ctx, ReplyObject, SessionReply } from './types';

export interface SessionHandler {
  onButton(ctx: Ctx, s: Session<any>, value: string): SessionReply;
  /** Typed answers in the session's channel (optional). Return null to ignore the message. */
  onText?(ctx: Ctx, s: Session<any>, text: string): ReplyObject | null;
}

export const handlers: Record<string, SessionHandler> = {
  [shift.KIND]: { onButton: shift.onButton, onText: shift.onText },
  quit: { onButton: onQuitButton },
  wipe: { onButton: onWipeButton },
  leaderboard: { onButton: onLeaderboardButton },
  achievements: { onButton: onAchievementsButton }
};
