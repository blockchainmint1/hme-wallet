/**
 * Loads the honest.money trusted-site registry once per app start and keeps
 * the last good copy on the device so labels work offline. Runs in web, APK
 * and extension (server fns are bridged on native/extension).
 */
import { useEffect } from "react";
import { setEcosystemSites, type RegistrySite } from "@/lib/web-login-hosts";
import { getEcosystemSites } from "@/lib/ecosystem-sites.functions";

const KEY = "hme:ecosystem-sites";

export function useEcosystemSites(): void {
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) {
        const record = JSON.parse(saved) as { at?: number; sites?: RegistrySite[] };
        if (typeof record.at === "number" && Date.now() - record.at < 5 * 60 * 1000 && Array.isArray(record.sites)) setEcosystemSites(record.sites);
      }
    } catch {
      /* ignore */
    }
    getEcosystemSites()
      .then(({ sites, verified }) => {
        // An outage keeps the names we already have instead of wiping them.
        if (verified !== true) return;
        setEcosystemSites(sites, true);
        try {
          localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), sites }));
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});
  }, []);
}
