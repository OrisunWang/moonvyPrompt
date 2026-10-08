import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

/** Test-created project roots isolate helper execution from real credentials and network calls. */
const roots: string[] = [];
/** Repository helper path remains constant while each test supplies its own tool project. */
const helper = resolve("skills/moonvy-ui-prompt/scripts/import_moonvy_ui.sh");

/** Creates a stale CLI plus a fake local build command to exercise rebuild and argument forwarding. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "moonvy-skill-"));
  roots.push(root);
  await mkdir(join(root, "dist"));
  await mkdir(join(root, "bin"));
  await writeFile(join(root, "unused.env"), "");
  await writeFile(join(root, "dist/cli.js"), 'throw new Error("stale build used");');
  await writeFile(join(root, "fresh-cli.js"), `
// Fake CLI records actual arguments; no network or credentials are used.
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "parse") {
  console.log(JSON.stringify({data: {itemId: "12345678-test"}}));
} else {
  const out = args[args.indexOf("--out") + 1];
  fs.mkdirSync(out + "/assets", {recursive: true});
  fs.writeFileSync(out + "/args.json", JSON.stringify(args));
  fs.writeFileSync(out + "/assets/index.json", "{}");
}
`);
  await writeFile(join(root, "bin/pnpm"), '#!/bin/sh\n[ "$BUILD_FAIL" = "1" ] && exit 7\ncp "$MOONVY_UI_PROMPT_DIR/fresh-cli.js" "$MOONVY_UI_PROMPT_DIR/dist/cli.js"\n', { mode: 0o755 });
  return { root, env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, MOONVY_UI_PROMPT_DIR: root,
    MOONVY_ENV_FILE: join(root, "unused.env"), MOONVY_OUTPUT_ROOT: join(root, "output"), BUILD_FAIL: "0" } };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(["--download-assets", "--no-download-assets"])("rebuilds stale dist and forwards %s", async (flag) => {
  const { root, env } = await fixture();
  const output = execFileSync("bash", [helper, "https://moonvy.com/project/p/f/i?a=1&amp;b=2", ...(flag === "--download-assets" ? [] : [flag])], { env, encoding: "utf8" });
  const args = JSON.parse(await readFile(join(root, "output/12345678/args.json"), "utf8"));
  expect(args).toContain(flag);
  expect(args[1]).toBe("https://moonvy.com/project/p/f/i?a=1&b=2");
  expect(output.includes("MOONVY_UI_ASSETS=")).toBe(flag === "--download-assets");
});

it("stops after build failure without invoking the old CLI", async () => {
  const { root, env } = await fixture();
  try {
    execFileSync("bash", [helper, "https://moonvy.com/project/p/f/i"], { env: { ...env, BUILD_FAIL: "1" }, stdio: "pipe" });
    throw new Error("Expected build failure");
  } catch (error) {
    expect((error as { status: number }).status).toBe(7);
  }
  await expect(readFile(join(root, "output/12345678/args.json"))).rejects.toMatchObject({ code: "ENOENT" });
});
