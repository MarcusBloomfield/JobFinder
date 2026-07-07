import type { BrowserContext } from 'playwright';
import {
  ApplicationRunRecord,
  getApplicationRunById,
  markApplicationRunSkipped
} from './applicationRunTrackingService';
import {
  listHumanInterventionsForRun,
  resolveHumanIntervention
} from './humanInterventionService';
import { markTrackedApplicationSkipped } from './applicationTrackingService';
import type { ApplicationRunCancellationHandle } from './applicationAdapters/types';

const CANCELLED_BY_USER_MESSAGE = 'Cancelled by user.';

interface ActiveCancellationSession {
  runId: string;
  cancelled: boolean;
  reason?: string;
  contexts: Set<BrowserContext>;
}

export class ApplicationRunCancellationError extends Error {
  constructor(message = CANCELLED_BY_USER_MESSAGE) {
    super(message);
    this.name = 'ApplicationRunCancellationError';
  }
}

const activeSessions = new Map<string, ActiveCancellationSession>();

const isCancelledRunRecord = (run: ApplicationRunRecord | null): boolean =>
  Boolean(
    run &&
      run.status === 'skipped' &&
      run.metadata &&
      typeof run.metadata.cancelledAt === 'string'
  );

const closeRegisteredContexts = async (
  session: ActiveCancellationSession
): Promise<void> => {
  await Promise.all(
    Array.from(session.contexts).map(context =>
      context.close().catch(() => undefined)
    )
  );
};

export const isApplicationRunCancellationError = (
  error: unknown
): error is ApplicationRunCancellationError =>
  error instanceof ApplicationRunCancellationError;

export const isApplicationRunCancellationRequested = (runId?: string): boolean => {
  if (!runId) {
    return false;
  }

  const session = activeSessions.get(runId);
  if (session?.cancelled) {
    return true;
  }

  return isCancelledRunRecord(getApplicationRunById(runId));
};

export const beginApplicationRunCancellationScope = (
  runId: string
): ApplicationRunCancellationHandle => {
  const session = activeSessions.get(runId) || {
    runId,
    cancelled: isApplicationRunCancellationRequested(runId),
    contexts: new Set<BrowserContext>()
  };

  activeSessions.set(runId, session);

  return {
    isCancellationRequested: () => isApplicationRunCancellationRequested(runId),
    throwIfCancellationRequested: () => {
      if (isApplicationRunCancellationRequested(runId)) {
        throw new ApplicationRunCancellationError(session.reason);
      }
    },
    registerBrowserContext: (context: BrowserContext) => {
      session.contexts.add(context);

      context.on('close', () => {
        session.contexts.delete(context);
      });

      if (session.cancelled) {
        void context.close().catch(() => undefined);
      }
    }
  };
};

export const endApplicationRunCancellationScope = (runId: string): void => {
  activeSessions.delete(runId);
};

export const requestApplicationRunCancellation = async (
  runId: string,
  reason = CANCELLED_BY_USER_MESSAGE
): Promise<ApplicationRunRecord | null> => {
  const run = getApplicationRunById(runId);
  if (!run) {
    return null;
  }

  const cancelledAt = new Date().toISOString();
  const session = activeSessions.get(runId);
  if (session) {
    session.cancelled = true;
    session.reason = reason;
  }

  listHumanInterventionsForRun(runId)
    .filter(intervention => intervention.status === 'pending')
    .forEach(intervention => {
      resolveHumanIntervention(intervention.id, 'skipped', reason);
    });

  markTrackedApplicationSkipped(run.applicationId, reason);

  const cancelled = markApplicationRunSkipped(runId, {
    errorMessage: reason,
    metadata: {
      ...(run.metadata || {}),
      cancelledAt,
      cancellationReason: reason
    }
  });

  if (session) {
    await closeRegisteredContexts(session);
  }

  return cancelled;
};
