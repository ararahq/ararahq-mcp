export type ToolResponse = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export const errorResponse = (message: string): ToolResponse => ({
  content: [{ type: "text" as const, text: `${message}` }],
  isError: true,
});

export const successResponse = (text: string): ToolResponse => ({
  content: [{ type: "text" as const, text }],
});
