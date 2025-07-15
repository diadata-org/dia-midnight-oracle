import { createLogger } from './logger-utils.js';
import { run } from './cli.js';
import { StandaloneE2EConfig } from './config.js';

const config = new StandaloneE2EConfig();
const logger = await createLogger(config.logDir);
await run(config, logger);
