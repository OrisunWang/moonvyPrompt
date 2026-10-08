import { usageError } from "./errors.js";
import type { MoonvyUrlParams } from "./types.js";

/** Parses the official project/folder/item route; folders alone cannot identify a design. */
export function parseMoonvyUrl(input: string): MoonvyUrlParams {
  /** Caller text is normalized only for HTML escaping; the original remains source metadata. */
  let url: URL;
  try { url = new URL(input.trim().replaceAll("&amp;", "&")); }
  catch { throw usageError("INVALID_MOONVY_URL", "Expected a full Moonvy HTTPS design URL."); }
  if (url.protocol !== "https:" || url.hostname !== "moonvy.com" || url.port || url.username || url.password) {
    throw usageError("INVALID_MOONVY_ORIGIN", "Use an HTTPS design link on moonvy.com.");
  }
  /** Exact path matching prevents accidental parsing of directory, share or unrelated routes. */
  const match = url.pathname.match(/^\/project\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+)\/?$/);
  if (!match) throw usageError("URL_MISSING_ITEM_ID", "Moonvy URL must include project, folder and item identifiers.", "Open the concrete design and copy /project/<projectId>/<folderId>/<itemId>.");
  return { source: input, projectId: match[1], folderId: match[2], itemId: match[3] };
}
