import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "../server/create.js";

export const runStdio = async (): Promise<void> => {
  const server = createServer();
  await server.connect(new StdioServerTransport());
};
