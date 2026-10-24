<div align="center">

<img src="public/icon-512.webp" alt="Honest Money wallet" width="112" height="112" />

# Honest Money

### Your keys. Your coins. Your call.

A self-custodial, multi-chain wallet for people who want more from their money—and less standing between them and it.

**[Open the wallet](https://mobile.honest.money) · [Explore Honest Money](https://honest.money)**

</div>

---

## One wallet. A bigger world.

Bitcoin on one chain. Stablecoins on another. A payment to make, a portfolio to check, an app to connect.

Honest Money brings those moments together. Move between networks, manage separate wallets, and connect to the Honest Money ecosystem without handing an exchange custody of your everyday wallet.

**Simple enough for a quick payment. Room to grow into something much bigger.**

## Built for more than holding

| | What you can do |
| :--- | :--- |
| **Go multi-chain** | Manage supported native coins and tokens across UTXO, EVM, Tron and Solana networks. |
| **Move your money** | Send, receive and use QR payment flows, with transaction activity close at hand. |
| **Keep wallets separate** | Create or import additional seed-based profiles without replacing your existing wallet. |
| **Keep an eye on your assets** | Track balances, prices and stablecoin holdings; hide balances when you want a little discretion. |
| **Explore swaps** | Compare supported swap routes through integrated providers. Availability depends on the asset pair, provider and region. |
| **Connect with purpose** | Discover ecosystem apps and review supported links, with separate look-only and Trading-pocket access. |
| **Take signing offline** | Pair compatible wallets with HME Vault for supported QR-based offline-signing flows. |

## Pocket-sized when you need it. Desktop-sized when you want it.

The phone experience is built around the things you do most: check a balance, scan a code, send a payment.

The next chapter is a dedicated **desktop workspace**: portfolio views, allocation, activity and separate spaces for Send, Receive, Swap, Vault, Stablecoins and ecosystem apps. It's a different interface—not a stretched phone screen—built on the same wallet foundation.

The project includes **web, Android and Chrome extension** targets. iPhone users can access the web experience; there is no native iOS app.

> **Release status:** This repository can contain work ahead of the live app. The expanded desktop workspace is awaiting independent review and release acceptance. Earn execution and Vault swaps remain unavailable pending their own reviews. A page or integration in the source is not a promise that it is ready for live funds.

## Self-custody, without the fine-print fantasy

Your everyday wallet seed is encrypted locally, and ordinary wallet signing happens on your device. You control the recovery phrase—and the responsibility that comes with it.

- **Back it up.** A lost recovery phrase can mean permanently lost funds. Store it offline; never paste it into an issue, chat or website asking for “verification.”
- **Know what you approve.** Look-only links and spending access are different. Trading integrations can share a separate pocket's spending key; optional tap-card service uses a separate pocket key encrypted on the backend, not your main wallet seed.
- **Understand the connections.** Balance providers, blockchain infrastructure, swap services and linked apps have their own availability and privacy characteristics. Self-custody does not mean every request stays offline.
- **Start small.** Check the network, destination, fees and approval details before moving meaningful amounts. Transactions can be irreversible.

Security review is part of the release process—not a claim that any wallet is risk-free. Nothing here is a guarantee of returns or financial advice.

## Make it yours

**[Open Honest Money →](https://mobile.honest.money)**

Create a wallet or import one using the supported recovery flow. Moving from another wallet? Keep the original wallet and its backup until you've verified your addresses and access. Adding a wallet should expand your setup, not erase it.

## For builders

Under the hood: **React 19 · TypeScript · TanStack Start · TanStack Query · Tailwind CSS · Capacitor · Chrome Manifest V3**.

The wallet shares core logic across platforms while allowing each interface to fit its environment. This project is developed with [Lovable](https://lovable.dev).

### Run locally

With [Bun](https://bun.sh) installed, clone this repository and run from its root:

```sh
bun install
bun run dev
```

The interface and connected services are separate concerns: a local checkout is not a fully configured production deployment. Use your own development configuration where required, and never commit private keys or service secrets.

```sh
# Run the test suite
bunx vitest run
```

Platform setup: [Android](ANDROID.md) · [Capacitor](CAPACITOR.md)

### Contribute thoughtfully

Useful bug reports, clear UX feedback and well-tested improvements are welcome. Include reproduction steps and the affected platform—but never recovery phrases, private keys or sensitive wallet data.

Changes to shared wallet behavior need consideration across web, Android and extension builds. Changes involving signing, permissions or money movement require extra care and independent review before release.

For a suspected security vulnerability, do not publish exploit details or sensitive data in a public issue; arrange a private channel with the maintainers first.

---

<div align="center">

**Honest Money. Less permission. More possibility.**

[Open your wallet](https://mobile.honest.money)

</div>
