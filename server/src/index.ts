import { createApp } from './app';
import { loadServerConfig } from './shared/config';

async function bootstrap() {
  const config = loadServerConfig();
  const app = createApp();

  try {
    await app.listen({ host: config.SERVER_HOST, port: config.SERVER_PORT });
    app.log.info(`API server listening on http://${config.SERVER_HOST}:${config.SERVER_PORT}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void bootstrap();
