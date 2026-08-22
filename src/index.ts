#!/usr/bin/env node
import "dotenv/config";
import { runCli } from "./cli.js";
import { runHttp } from "./transports/http.js";
import { runStdio } from "./transports/stdio.js";

const main = async (): Promise<void> => {
  const command = process.argv[2];
  if (command && (await runCli(command))) return;
  const useHttp =
    process.env.MCP_TRANSPORT === "http" ||
    (process.env.PORT !== undefined && !process.argv.includes("--stdio"));
  if (useHttp) await runHttp();
  else await runStdio();
};

if (process.env.NODE_ENV !== "test") {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown startup error";
    process.stderr.write(`AraraHQ MCP failed: ${message}\n`);
    process.exitCode = 1;
  });
}
