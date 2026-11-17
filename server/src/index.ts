import {createApp} from './app.ts';
import {env} from './config/env.ts';
import {logKineticAccessAtStartup} from './lib/kineticAccess.ts';
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
  // V1 Kinetic access (only reported while the release is on): an invalid configuration is an ERROR line, never a crash; no account id is ever logged.
  logKineticAccessAtStartup(env, logger);

  // Non-fatal: a problem in the human-curated SFX library is a warning, never a reason not to start.
  void validateSfxLibrary()
    .then(report => {
      for (const issue of report.issues) logger.warn({level: issue.level, code: issue.code, fileName: issue.fileName, message: issue.message, suggestion: issue.suggestion}, 'sfx.catalog_warning');
    })
    .catch(error => logger.warn({reason: error instanceof Error ? error.message.slice(0, 200) : 'sfx_validate'}, 'sfx.catalog_warning'));

  // Recovery scans are separate from the durable job table. Unset leaves the table active and schedules nothing.
  if (env.FULL_EDIT_RECOVERY_ENABLED) {
    startFullEditRecoveryWorker();
  } else {
    logger.info('full edit recovery worker disabled');
  }

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
