import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("cli smoke", () => {
  it("parses a Moonvy URL without network", () => {
    const output = execFileSync("node", ["--import", "tsx", "src/cli.ts", "parse", "https://moonvy.com/project/p/f/i", "--json"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    expect(JSON.parse(output)).toMatchObject({ ok: true, data: { projectId: "p", itemId: "i" } });
  });

  it("reports missing credentials without leaking a token", () => {
    const result = spawnSync("node", ["--import", "tsx", "src/cli.ts", "run", "https://moonvy.com/project/p/f/i", "--out", ".moonvy.local/test", "--json"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, MOONVY_COOKIE: "", MOONVY_AUTHORIZATION: "" }
    });
    const envelope = JSON.parse(result.stdout);
    expect(result.status).toBe(3);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("MISSING_MOONVY_AUTHORIZATION");
    expect(result.stdout).not.toContain("Cookie:");
  });
});
