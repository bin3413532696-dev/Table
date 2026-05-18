import { createApp } from './app';
import { loadServerConfig } from './shared/config';
import { prisma } from './db/client';
import { closeCheckpointer, initCheckpointer } from './modules/agent/langgraph/postgres-checkpointer';

async function bootstrap() {
  const config = loadServerConfig();
  const app = createApp();

  // 初始化 LangGraph Checkpointer（创建必要表）
  try {
    await initCheckpointer();
    app.log.info('LangGraph checkpointer initialized');
  } catch (error) {
    app.log.error({ err: error }, 'Failed to initialize checkpointer');
  }

  try {
    await app.listen({ host: config.SERVER_HOST, port: config.SERVER_PORT });
    app.log.info(`API server listening on http://${config.SERVER_HOST}:${config.SERVER_PORT}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }

  let shuttingDown = false;

  async function gracefulShutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;

    app.log.info(`Received ${signal}, shutting down gracefully...`);
    try {
      await app.close();
      await closeCheckpointer();
      await prisma.$disconnect();
      app.log.info('Server shut down successfully');
      process.exit(0);
    } catch (error) {
      app.log.error(error, 'Error during graceful shutdown');
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, 'Unhandled rejection');
    void gracefulShutdown('unhandledRejection');
  });

  process.on('uncaughtException', (error) => {
    app.log.error({ err: error }, 'Uncaught exception');
    void gracefulShutdown('uncaughtException');
  });
}

void bootstrap();
