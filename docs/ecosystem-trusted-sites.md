# Ecosystem trusted-site registry (wallet side)

The wallet labels sign-in and xpub-link requests from sites listed by the
Honest.Money Ecosystem project (Admin → SSO sites, table `sso_sites`).
A site on the list shows its friendly name and a "Verified honest.money
ecosystem site" note; anything else still works but shows a warning.

The strict sign-in message template and hardened-branch-only xpub rule apply
to every site. Spending delegation additionally requires the site to be marked
`delegate: true` in a freshly server-verified registry; being on the list alone
is not enough, and offline labels and name patterns never authorize it.

## Feed the ecosystem must publish

`GET https://honest.money/api/public/v1/trusted-sites`

```json
{ "v": 1, "sites": [
  { "host": "filefingerprint.com", "label": "File Fingerprint", "active": true, "delegate": false, "delegate_modes": [], "delegate_branches": [] },
  { "host": "seeds.honest.money", "label": "SEEDS", "active": true, "delegate": true, "delegate_modes": ["approve", "access"], "delegate_branches": [1106] }
] }
```

`delegate: true` marks a site as allowed to request trading/spending access
(`hm-link-delegate`). A missing field or any value other than literal `true`
means sign-in labeling only — the wallet refuses spending links from it.

A `delegate: true` site also needs, or the wallet refuses it:
- `delegate_modes`: `"approve"` (xpubs only, member approves each trade)
  and/or `"access"` (sealed spending key). The wallet only offers these.
- `delegate_branches`: the Trading branches (hardened account numbers) HME
  reserved for the site. Wallet hard limits: 1106–2105, never 1107 (tap
  card). A branch listed for two sites is refused for both.

The site's link code must ask for one of its own branches, the same account on
every chain (e.g. `m/44'/696969'/1108'`). Per wallet, a branch belongs to the
first site it was shared with and a revoked spending branch is retired; if the
requested branch is unavailable the wallet uses the site's next reserved branch
and returns the real `account`/`paths` in the submission, or refuses when none
is left. To let a site re-link after a revoke, HME reserves more than one
branch for it.

Request headers (current Honest Money API):
- `Authorization: Bearer <dedicated site API key>`
- `X-HME-Site: <stable site code>`
- Site permission: `trusted-sites:read`.
- Configure the newly issued **wallet-only** site key as `HME_ECOSYSTEM`;
  this wallet sends the stable site code `wallet`. This is the current Honest
  Money API convention, not a fallback to the retired cross-partner key.
- `activity:write` is separately needed for optional Hub attribution. Registry
  read permission does not imply that permission or partner payment authority.

Response headers:
- `x-hme-timestamp` — unix seconds when signed
- `x-hme-signature` — hex HMAC-SHA256 of `${timestamp}.${rawBody}` with that site's dedicated API key

The wallet rejects malformed/unsigned/mis-signed or >5-minute-old responses. Server
cache lasts five minutes. Spending approval refreshes the registry and fails
closed on unavailability/removal. Empty valid lists clear trust. Cached labels
may still display offline, but cannot grant spending access.

Asymmetric registry verification remains a coordinated partner change: no
public-key registry endpoint exists in the current Honest Money source.
