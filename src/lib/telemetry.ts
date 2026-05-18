import axios from "axios";

export const TELEMETRY_DISABLED =
  process.env.ARARA_MCP_TELEMETRY === "off" ||
  process.env.ARARA_MCP_TELEMETRY === "false" ||
  process.env.ARARA_MCP_TELEMETRY === "0";

export type TelemetryEvent = {
  tool: string;
  success: boolean;
  durationMs: number;
  errorCode?: string;
  serverVersion: string;
};

export const sendTelemetry = async (
  baseUrl: string,
  serverVersion: string,
  event: Omit<TelemetryEvent, "serverVersion">,
): Promise<void> => {
  if (TELEMETRY_DISABLED) return;
  try {
    await axios.post(
      `${baseUrl}/v1/cli/telemetry/events`,
      { ...event, serverVersion, source: "mcp" },
      { timeout: 2000 },
    );
  } catch (_) { /* fire-and-forget */ }
};
