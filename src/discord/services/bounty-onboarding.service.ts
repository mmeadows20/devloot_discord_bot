import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { BountyCurrency } from '../utils/bounty-validation';

export const BOUNTY_SESSION_TTL_MS = 15 * 60 * 1000;
export const BOUNTY_CUSTOM_ID_PREFIX = 'cb';

export type BountyOnboardingStep =
  | 'intro'
  | 'title'
  | 'github'
  | 'reward'
  | 'deadline'
  | 'preview';

export interface BountyDraft {
  title?: string;
  summary?: string;
  repository?: string;
  issueUrl?: string;
  issueNumber?: number;
  rewardAmount?: number;
  currency: BountyCurrency;
  deadline?: Date;
}

export interface BountyOnboardingSession {
  id: string;
  userId: string;
  guildId: string;
  draft: BountyDraft;
  step: BountyOnboardingStep;
  returnToPreview: boolean;
  cancelReturnStep: BountyOnboardingStep | null;
  publishing: boolean;
  createdAt: number;
  expiresAt: number;
}

export interface BountyCustomId {
  sessionId: string;
  action: string;
}

export function buildBountyCustomId(
  sessionId: string,
  action: string,
): string {
  return `${BOUNTY_CUSTOM_ID_PREFIX}:${sessionId}:${action}`;
}

export function parseBountyCustomId(customId: string): BountyCustomId | null {
  if (!customId.startsWith(`${BOUNTY_CUSTOM_ID_PREFIX}:`)) return null;

  const [, sessionId, ...actionParts] = customId.split(':');
  if (!sessionId || actionParts.length === 0) return null;

  return { sessionId, action: actionParts.join(':') };
}

export function isBountyDraftComplete(draft: BountyDraft): boolean {
  return (
    !!draft.title &&
    !!draft.summary &&
    !!draft.repository &&
    !!draft.issueUrl &&
    draft.issueNumber !== undefined &&
    draft.rewardAmount !== undefined
  );
}

@Injectable()
export class BountyOnboardingService implements OnModuleDestroy {
  private readonly logger = new Logger(BountyOnboardingService.name);
  private readonly sessions = new Map<string, BountyOnboardingSession>();
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();
  private readonly activeSessionByUser = new Map<string, string>();

  createSession(userId: string, guildId: string): BountyOnboardingSession {
    const existingSessionId = this.activeSessionByUser.get(userId);
    if (existingSessionId) this.deleteSession(existingSessionId);

    const now = Date.now();
    const session: BountyOnboardingSession = {
      id: randomUUID(),
      userId,
      guildId,
      draft: { currency: 'USDC' },
      step: 'intro',
      returnToPreview: false,
      cancelReturnStep: null,
      publishing: false,
      createdAt: now,
      expiresAt: now + BOUNTY_SESSION_TTL_MS,
    };

    this.sessions.set(session.id, session);
    this.activeSessionByUser.set(userId, session.id);
    this.scheduleExpiry(session);

    return session;
  }

  getSession(sessionId: string): BountyOnboardingSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (session.expiresAt <= Date.now()) {
      this.logger.log(`[bounty-wizard] Session ${sessionId} expired`);
      this.deleteSession(sessionId);
      return null;
    }

    return session;
  }

  touch(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.expiresAt = Date.now() + BOUNTY_SESSION_TTL_MS;
    this.scheduleExpiry(session);
  }

  deleteSession(sessionId: string): void {
    const timer = this.expiryTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.expiryTimers.delete(sessionId);
    }

    const session = this.sessions.get(sessionId);
    if (
      session &&
      this.activeSessionByUser.get(session.userId) === sessionId
    ) {
      this.activeSessionByUser.delete(session.userId);
    }

    this.sessions.delete(sessionId);
  }

  onModuleDestroy(): void {
    for (const timer of this.expiryTimers.values()) {
      clearTimeout(timer);
    }
    this.expiryTimers.clear();
    this.sessions.clear();
    this.activeSessionByUser.clear();
  }

  private scheduleExpiry(session: BountyOnboardingSession): void {
    const existingTimer = this.expiryTimers.get(session.id);
    if (existingTimer) clearTimeout(existingTimer);

    const delay = Math.max(0, session.expiresAt - Date.now());
    const timer = setTimeout(() => {
      const current = this.sessions.get(session.id);
      if (current && current.expiresAt <= Date.now()) {
        this.logger.log(
          `[bounty-wizard] Session ${session.id} timed out for ${session.userId}`,
        );
        this.deleteSession(session.id);
      }
    }, delay);

    timer.unref();
    this.expiryTimers.set(session.id, timer);
  }
}
