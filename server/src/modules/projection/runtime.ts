import type { FastifyInstance, FastifyBaseLogger } from 'fastify';
import { loadServerConfig } from '../../shared/config';
import { processKnowledgeProjectionEvent } from './knowledge';
import {
  claimProjectionOutboxEvent,
  listPendingProjectionOutboxEvents,
  markProjectionOutboxEventProcessed,
  rescheduleProjectionOutboxEvent,
} from './outbox';

let pollTimer: NodeJS.Timeout | null = null;
let kickTimer: NodeJS.Timeout | null = null;
let isProcessing = false;
let loggerRef: FastifyBaseLogger | Console = console;

async function drainProjectionOutboxBatch() {
  if (isProcessing) {
    return;
  }

  isProcessing = true;

  try {
    const config = loadServerConfig();
    const events = await listPendingProjectionOutboxEvents(config.PROJECTION_OUTBOX_BATCH_SIZE);

    for (const event of events) {
      const claimed = await claimProjectionOutboxEvent(event.id);
      if (!claimed) {
        continue;
      }

      try {
        await processKnowledgeProjectionEvent(event);
        await markProjectionOutboxEventProcessed(event.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        loggerRef.error({ err: error, eventId: event.id }, 'Projection outbox event failed');
        await rescheduleProjectionOutboxEvent(event.id, event.attempts + 1, message);
      }
    }
  } finally {
    isProcessing = false;
  }
}

function scheduleImmediateDrain() {
  if (kickTimer) {
    return;
  }

  kickTimer = setTimeout(() => {
    kickTimer = null;
    void drainProjectionOutboxBatch();
  }, 10);
}

export function kickProjectionRuntime() {
  scheduleImmediateDrain();
}

export function registerProjectionRuntime(app: FastifyInstance) {
  app.addHook('onReady', async () => {
    const config = loadServerConfig();
    loggerRef = app.log;

    if (pollTimer) {
      clearInterval(pollTimer);
    }

    pollTimer = setInterval(() => {
      void drainProjectionOutboxBatch();
    }, config.PROJECTION_OUTBOX_POLL_MS);

    scheduleImmediateDrain();
    app.log.info('Projection runtime started');
  });

  app.addHook('onClose', async () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }

    if (kickTimer) {
      clearTimeout(kickTimer);
      kickTimer = null;
    }
  });
}
