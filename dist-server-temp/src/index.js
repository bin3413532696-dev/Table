"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const config_1 = require("./shared/config");
const client_1 = require("./db/client");
const postgres_checkpointer_1 = require("./modules/agent/langgraph/postgres-checkpointer");
async function bootstrap() {
    const config = (0, config_1.loadServerConfig)();
    const app = (0, app_1.createApp)();
    // 初始化 LangGraph Checkpointer（创建必要表）
    try {
        await (0, postgres_checkpointer_1.initCheckpointer)();
        app.log.info('LangGraph checkpointer initialized');
    }
    catch (error) {
        app.log.error({ err: error }, 'Failed to initialize checkpointer');
    }
    try {
        await app.listen({ host: config.SERVER_HOST, port: config.SERVER_PORT });
        app.log.info(`API server listening on http://${config.SERVER_HOST}:${config.SERVER_PORT}`);
    }
    catch (error) {
        app.log.error(error);
        process.exit(1);
    }
    let shuttingDown = false;
    async function gracefulShutdown(signal) {
        if (shuttingDown)
            return;
        shuttingDown = true;
        app.log.info(`Received ${signal}, shutting down gracefully...`);
        try {
            await app.close();
            await (0, postgres_checkpointer_1.closeCheckpointer)();
            await client_1.prisma.$disconnect();
            app.log.info('Server shut down successfully');
            process.exit(0);
        }
        catch (error) {
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
