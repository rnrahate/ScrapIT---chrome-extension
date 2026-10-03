export const metrics = {
  recordLatency: (endpoint: string, ms: number) => {},
  incrementToolCall: (toolName: string) => {},
  incrementError: (type: string) => {},
  recordTokenUsage: (input: number, output: number) => {}
};
