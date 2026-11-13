// The LM Studio SDK imports Node's `process`. Browsers don't have it, so this stands in:
// no environment variables, and `browser: true` so the SDK skips its terminal-only code.
export default { env: {} as Record<string, string | undefined>, browser: true };
