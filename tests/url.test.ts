import { describe, expect, it } from "vitest";
import { parseMoonvyUrl } from "../src/url.js";

describe("Moonvy route parsing", () => {
  it("extracts the supplied concrete design identifiers offline", () => {
    expect(parseMoonvyUrl("https://moonvy.com/project/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333?viewMode=spec"))
      .toMatchObject({projectId: "11111111-1111-4111-8111-111111111111", folderId: "22222222-2222-4222-8222-222222222222", itemId: "33333333-3333-4333-8333-333333333333"});
  });
  it.each(["https://moonvy.com/project/p/f", "https://moonvy.com/project/p", "https://evil.com/project/p/f/i", "https://moonvy.com.evil.com/project/p/f/i", "http://moonvy.com/project/p/f/i", "https://u:secret@moonvy.com/project/p/f/i", "https://moonvy.com/project/p/f/i/extra", "pid=p&image_id=i"])("rejects %s", url => {
    expect(() => parseMoonvyUrl(url)).toThrow();
  });
});
