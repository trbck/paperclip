// Account-wide provider quota cooldown.
//
// A provider quota (Ollama Cloud's "session usage limit", Claude's 5-hour
// limit) is shared by every agent that talks to the same endpoint. Retrying
// each run on its own ladder means every timer, assignment and retry still
// spends a request just to collect another 429. Once one run hits the quota,
// every run against the same base URL is held until the cooldown ends,
// without starting the CLI.

const DEFAULT_COOLDOWN_MINUTES = 60;

const cooldowns = new Map<string, Date>();

export function providerQuotaKey(env: Record<string, string | undefined>): string {
  const baseUrl = (env.ANTHROPIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return baseUrl || "anthropic";
}

function cooldownMs(env: Record<string, string | undefined>): number {
  const minutes = Number(env.PAPERCLIP_PROVIDER_QUOTA_COOLDOWN_MINUTES);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_COOLDOWN_MINUTES) * 60_000;
}

export function noteProviderQuota(
  key: string,
  providerResetAt: Date | null,
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
): Date {
  const candidate = providerResetAt && providerResetAt.getTime() > now.getTime()
    ? providerResetAt
    : new Date(now.getTime() + cooldownMs(env));
  const existing = cooldowns.get(key);
  const until = existing && existing.getTime() > candidate.getTime() ? existing : candidate;
  cooldowns.set(key, until);
  return until;
}

export function activeProviderQuotaCooldown(key: string, now: Date = new Date()): Date | null {
  const until = cooldowns.get(key);
  if (!until) return null;
  if (until.getTime() <= now.getTime()) {
    cooldowns.delete(key);
    return null;
  }
  return until;
}

export function resetProviderQuotaCooldowns() {
  cooldowns.clear();
}
