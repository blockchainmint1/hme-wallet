import { useEffect, useState } from "react";
import { useWallet } from "@/lib/txc/wallet-context";
import { seedFromMnemonic } from "@/lib/txc/wallet";
import { DELEGATE_LINKS_EVENT, listDelegateLinks, type DelegateLinkRecord } from "@/lib/xpub-link/delegate";
import { getEcosystemSites } from "@/lib/ecosystem-sites.functions";
import { setEcosystemSites, spendingGrant } from "@/lib/web-login-hosts";
import { SEEDS_HOST, seedsLinks } from "@/lib/seeds/pocket-view";
import { detectSeedsPockets, foundSeedsPockets, pocketProbes, rememberFoundSeedsPockets, SEEDS_FOUND_EVENT } from "@/lib/seeds/pocket-found";

/** Profiles already checked this session, so each unlock scans at most once. */
const checked = new Set<string>();

/** Fresh signed honest.money list → Seeds' reserved branches, or null if it couldn't be verified. */
async function seedsRegistryBranches(): Promise<number[] | null> {
  const r = await getEcosystemSites().catch(() => null);
  if (!r || r.verified !== true) return null;
  setEcosystemSites(r.sites, true);
  return spendingGrant(SEEDS_HOST)?.branches ?? [];
}

/**
 * Seeds links recorded on this device, plus pockets found on the blockchain at
 * Seeds' reserved branch when this device has no record for them.
 */
export function useSeedsPocket(): { links: DelegateLinkRecord[]; found: number[] } {
  const { unlocked, activeProfileId } = useWallet();
  const [links, setLinks] = useState<DelegateLinkRecord[]>([]);
  const [found, setFound] = useState<number[]>([]);
  const canSee = !!unlocked && unlocked.mode !== "vault" && !!unlocked.mnemonic;

  useEffect(() => {
    if (!canSee) { setLinks([]); setFound([]); return; }
    const h = () => {
      const l = seedsLinks(listDelegateLinks());
      setLinks(l);
      setFound(foundSeedsPockets().filter((a) => !l.some((r) => r.account === a)));
    };
    h();
    window.addEventListener(DELEGATE_LINKS_EVENT, h);
    window.addEventListener(SEEDS_FOUND_EVENT, h);
    return () => { window.removeEventListener(DELEGATE_LINKS_EVENT, h); window.removeEventListener(SEEDS_FOUND_EVENT, h); };
  }, [canSee, unlocked, activeProfileId]);

  useEffect(() => {
    if (!canSee || !activeProfileId || checked.has(activeProfileId)) return;
    if (seedsLinks(listDelegateLinks()).length > 0) return;
    checked.add(activeProfileId);
    let live = true;
    (async () => {
      const registryBranches = await seedsRegistryBranches();
      if (registryBranches === null) { checked.delete(activeProfileId); return; }
      const seed = await seedFromMnemonic(unlocked!.mnemonic!, unlocked!.passphrase ?? "");
      try {
        const hits = await detectSeedsPockets({ registryBranches, probesFor: (a) => pocketProbes(seed, a) });
        // Written only while this same wallet is still open (storage is per wallet).
        if (!live) { checked.delete(activeProfileId); return; }
        if (hits.length) rememberFoundSeedsPockets(hits);
      } finally { seed.fill(0); }
    })().catch(() => { checked.delete(activeProfileId); });
    return () => { live = false; };
  }, [canSee, unlocked, activeProfileId]);

  return { links, found };
}
