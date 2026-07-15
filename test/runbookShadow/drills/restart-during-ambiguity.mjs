#!/usr/bin/env node
import { runDrillCli } from '../lib/cli.mjs';

await runDrillCli('restart-during-ambiguity');
