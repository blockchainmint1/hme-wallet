# Swap provider choice and list visibility review

## Reported evidence
Phone history: 30,000 DOGE THORChain at 11:25, 20,000 DOGE FixedFloat at 11:24, 10,000 DOGE THORChain at 11:24. FixedFloat dashboard: 20,000 DOGE order QJRS43 Pending, 10,000 DOGE order DHHXMF New at 11:23. The screenshots alone cannot establish the recipient of the 10,000 DOGE payment.

## Findings
Reviewing a FixedFloat route creates an exchange order before the deposit is broadcast. Editing/cancelling review does not erase the external order. Quotes alone do not create orders. Thus a New order can be an unused review; this is possible, not confirmed as what Bobby did.

The selection expression previously fell back to the top quote if an explicitly selected provider disappeared after refresh. This could silently change a provider at the form stage. It does not explain a THORChain-labelled broadcast going to FixedFloat in the current source: send uses the stored order deposit address/memo and saves that same order provider. Actual transaction verification and installed APK version remain outstanding.

## Changes
- Shared selection helper preserves explicit provider intent; missing selected quote blocks review instead of fallback. Best quote remains automatic only before any explicit choice.
- Order response must match the requested provider before review is shown.
- Review refuses stale debounced amounts and active quote fetches.
- Swap page is non-shrinking with bottom safe-area spacing so the last row scrolls clear of phone navigation.
- No wallet storage keys, histories, credentials, backend dispatch, transaction construction, spending gates or release settings changed.

## Verification
12 tests across selection, history ownership and FixedFloat response handling passed. Preview build OK.
Browser mounted actual UtxoSwap with a controlled seed-wallet fixture and mocked quotes/orders, not real wallet keys. Selecting THORChain then removing its quote blocked Review; explicitly selecting FixedFloat then reviewing issued one mocked FixedFloat order. At 390×844 the last swap row ended at y=812 with 32px bottom spacing, screenshot inspected. No page errors. No real orders, signatures or funds sent.

## Remaining acceptance
Obtain actual 10,000 DOGE deposit transaction ID and inspect outputs/memo against THORChain status. Confirm installed APK version and independent acceptance before shipping shared source to web, APK and extension. Nothing published or packaged. Physical Android navigation-bar acceptance remains unverified.