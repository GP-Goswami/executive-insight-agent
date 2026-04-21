export function isDebugMode(): boolean {
  return process.env.DEBUG === "true";
}

export function debugLog(source: string, message: string): void {
  if (isDebugMode()) {
    console.log(`[DEBUG][${source}] ${message}`);
  } else {
    console.log(`[${source}] ${message.substring(0, 200)}`);
  }
}

export function logApiKeyStatus(): void {
  const keys = [
    { name: "SEMRUSH_API_KEY", configured: !!process.env.SEMRUSH_API_KEY },
    { name: "DATAFORSEO_LOGIN", configured: !!process.env.DATAFORSEO_LOGIN },
    { name: "DATAFORSEO_PASSWORD", configured: !!process.env.DATAFORSEO_PASSWORD },
    { name: "GOOGLE_SERVICE_ACCOUNT_JSON", configured: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON },
    { name: "RESEND_API_KEY", configured: !!process.env.RESEND_API_KEY },
  ];

  console.log("=== API Key Configuration Status ===");
  for (const key of keys) {
    console.log(`  ${key.name}: ${key.configured ? "CONFIGURED" : "NOT SET"}`);
  }
  console.log(`  DEBUG mode: ${isDebugMode() ? "ENABLED" : "DISABLED"}`);
  console.log("====================================");
}
