import { afterEach, describe, expect, it } from "vitest";
import {
  activeProviderQuotaCooldown,
  noteProviderQuota,
  providerQuotaKey,
  resetProviderQuotaCooldowns,
} from "./quota-cooldown.js";

describe("provider quota cooldown", () => {
  afterEach(() => resetProviderQuotaCooldowns());
  const now = new Date("2026-10-15T08:00:00Z");

  it("keys by base URL so every agent on the same account shares one cooldown", () => {
    expect(providerQuotaKey({ ANTHROPIC_BASE_URL: "http://172.18.0.1:11434/" })).toBe(
      "http://172.18.0.1:11434",
    );
    expect(providerQuotaKey({})).toBe("anthropic");
  });

  it("uses the default cooldown when the provider gives no reset time", () => {
    const until = noteProviderQuota("k", null, now, {});
    expect(until.toISOString()).toBe("2026-10-15T09:00:00.000Z");
    expect(activeProviderQuotaCooldown("k", new Date("2026-10-15T08:30:00Z"))?.toISOString()).toBe(
      "2026-10-15T09:00:00.000Z",
    );
    expect(activeProviderQuotaCooldown("k", new Date("2026-10-15T09:00:01Z"))).toBeNull();
    expect(activeProviderQuotaCooldown("other", now)).toBeNull();
  });

  it("honours a provider reset time and the env override", () => {
    const reset = new Date("2026-10-15T12:00:00Z");
    expect(noteProviderQuota("k", reset, now, {}).toISOString()).toBe(reset.toISOString());
    resetProviderQuotaCooldowns();
    const until = noteProviderQuota("k", null, now, { PAPERCLIP_PROVIDER_QUOTA_COOLDOWN_MINUTES: "15" });
    expect(until.toISOString()).toBe("2026-10-15T08:15:00.000Z");
  });

  it("never shortens an existing cooldown", () => {
    noteProviderQuota("k", new Date("2026-10-15T12:00:00Z"), now, {});
    expect(noteProviderQuota("k", null, now, {}).toISOString()).toBe("2026-10-15T12:00:00.000Z");
  });
});
