import {createApp} from './app.ts';
import {env} from './config/env.ts';
import {logger} from './lib/logger.ts';
import {getKv} from './store/kv.ts';

async function main(): Promise<void> {
  // Connect the store before accepting traffic so the first request is not the
  // one that discovers Redis is down.
  await getKv();

  const server = createApp().listen(env.PORT, () => {
    logger.info({port: env.PORT, env: env.NODE_ENV}, 'video engine listening');
  });

  const shutdown = (signal: string) => {
    logger.info({signal}, 'shutting down');
    server.close(() => process.exit(0));
    // In-flight analyses hold ffmpeg children; give them a bounded grace period.
    setTimeout(() => process.exit(0), 15_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', error => {
    logger.error({error}, 'unhandled rejection');
  });
}

void main();
