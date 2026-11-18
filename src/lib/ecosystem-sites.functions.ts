import { createServerFn } from "@tanstack/react-start";

/**
 * Public list of honest.money ecosystem sites. `verified` is true only when the
 * signed registry was fetched and checked just now; on any failure the list is
 * empty and `verified` is false, so callers never mistake an outage for
 * "honest.money removed every site".
 */
export const getEcosystemSites = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { loadEcosystemSites } = await import("./ecosystem-sites.server");
    return { sites: await loadEcosystemSites(), verified: true as boolean };
  } catch (e) {
    console.warn("ecosystem registry unavailable", e);
    return { sites: [] as import("./ecosystem-sites.server").EcosystemSite[], verified: false as boolean };
  }
});
