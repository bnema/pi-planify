#!/usr/bin/env node
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { runCli } = await jiti.import("../src/cli.ts");

process.exitCode = await runCli(process.argv.slice(2));
