import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest } from "../lib/api.js";
import {
  coverageSchema,
  identitySchema,
  numbersSchema,
  planSchema,
  routineSchema,
  templatesSchema,
  todaySchema,
} from "../lib/schemas.js";
import { z } from "zod";

const json = (value: unknown): string => JSON.stringify(value, null, 2);
const routinesResponseSchema = z.object({ data: z.array(routineSchema) });

const registerJsonResource = (
  server: McpServer,
  name: string,
  uri: string,
  title: string,
  description: string,
  loader: () => Promise<unknown>,
): void => {
  server.registerResource(
    name,
    uri,
    { title, description, mimeType: "application/json" },
    async (resourceUri) => {
      try {
        return {
          contents: [
            {
              uri: resourceUri.toString(),
              mimeType: "application/json",
              text: json(await loader()),
            },
          ],
        };
      } catch {
        return {
          contents: [
            {
              uri: resourceUri.toString(),
              mimeType: "application/json",
              text: json({
                error: { code: "RESOURCE_UNAVAILABLE", message: "Resource could not be loaded." },
              }),
            },
          ],
        };
      }
    },
  );
};

export const registerAllResources = (server: McpServer): void => {
  registerJsonResource(
    server,
    "organization",
    "arara://organization",
    "Organization",
    "Authenticated identity and current AraraHQ plan.",
    async () => {
      const [identity, plan] = await Promise.all([
        apiRequest("/auth/me", { schema: identitySchema }),
        apiRequest("/v1/organizations/me/plan", { schema: planSchema }),
      ]);
      return { identity, plan };
    },
  );
  registerJsonResource(
    server,
    "operation_health",
    "arara://operation/health",
    "Operation health",
    "Today, channel health and published Atendimento routines.",
    async () => {
      const [today, numbers, routines] = await Promise.all([
        apiRequest("/v1/operation/today", { schema: todaySchema }),
        apiRequest("/v1/organizations/me/numbers", { schema: numbersSchema }),
        apiRequest("/v1/operation/routines", { schema: routinesResponseSchema }),
      ]);
      return {
        today,
        channels: numbers,
        publishedRoutines: routines.data.filter((routine) => routine.published),
      };
    },
  );
  registerJsonResource(
    server,
    "approved_templates",
    "arara://templates/approved",
    "Approved templates",
    "Templates that Meta currently allows for sending.",
    async () => {
      const templates = await apiRequest("/v1/templates", { schema: templatesSchema });
      return templates.filter(
        (template) => template.providerStatus === "APPROVED" && template.availableForSending,
      );
    },
  );
  registerJsonResource(
    server,
    "channels",
    "arara://channels",
    "WhatsApp channels",
    "Configured numbers and slot state for this organization.",
    () => apiRequest("/v1/organizations/me/numbers", { schema: numbersSchema }),
  );
  registerJsonResource(
    server,
    "coverage",
    "arara://coverage",
    "Service coverage",
    "Working hours and after-hours policy for Atendimento.",
    () => apiRequest("/v1/operation/coverage", { schema: coverageSchema }),
  );
};
