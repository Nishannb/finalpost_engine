import {createApp} from './app.ts';
import {env} from './config/env.ts';
import {logger} from './lib/logger.ts';
import {validateSfxLibrary} from './lib/sfxCatalog.ts';
import {startFullEditRecoveryWorker} from './pipeline/captionsEditRunner.ts';
import {getKv} from './store/kv.ts';

async function main(): Promise<void> {
  // Connect the store before accepting traffic so the first request is not the
  // one that discovers Redis is down.
  await getKv();

  logger.info(
    {
      port: env.PORT,
      env: env.NODE_ENV,
      auth: {
        supabaseUrl: Boolean(env.SUPABASE_URL),
        supabaseAnonKey: Boolean(env.SUPABASE_ANON_KEY),
        jwtSecret: Boolean(env.SUPABASE_JWT_SECRET),
        devAuthBypass: env.DEV_AUTH_BYPASS && env.NODE_ENV !== 'production',
      },
    },
    'video engine auth config',
  );

  // Non-fatal: a problem in the human-curated SFX library is a warning, never a reason not to start.
  void validateSfxLibrary()
    .then(report => {
      for (const issue of report.issues) logger.warn({level: issue.level, code: issue.code, fileName: issue.fileName, message: issue.message, suggestion: issue.suggestion}, 'sfx.catalog_warning');
    })
    .catch(error => logger.warn({reason: error instanceof Error ? error.message.slice(0, 200) : 'sfx_validate'}, 'sfx.catalog_warning'));

  // Picks up full edits a previous process left half-done (needs the durable job table; see store/durableJobs.ts).
  startFullEditRecoveryWorker();

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
