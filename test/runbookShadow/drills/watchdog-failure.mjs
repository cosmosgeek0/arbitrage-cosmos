#!/usr/bin/env node
import { runDrillCli } from '../lib/cli.mjs';

await runDrillCli('watchdog-failure');
