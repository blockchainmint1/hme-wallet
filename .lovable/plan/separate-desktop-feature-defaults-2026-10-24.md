# Separate desktop feature defaults

## What changes
- Give `/desktop` its own settings page and saved desktop choices, separate from phone settings. Existing phone, Android and extension defaults remain unchanged.
- Enable all supported networks and available optional desktop features by default. Keep address confirmation and spam filtering on. Do not automatically enable biometric unlock, hide balances, create shared wallets, connect sites or grant spending access.
- Restore the full existing LTC/DOGE swap form on desktop by removing its dependence on phone chain choices. Preserve destination selection, provider comparison, fees, review and saved orders.
- Show Ethereum, Base and BNB Chain swap availability in the desktop swap selector with their paused status, rather than making them appear missing. Do not invent TXC, ISK, ZCU or other swap routes that do not exist.
- Keep EVM swap execution, Vault swaps and Earn execution paused until their separate safety reviews pass.

## Technical approach
- Add explicit desktop preference scope for feature toggles and chain settings; desktop chain choices remain device-wide across profiles, desktop feature choices remain profile-isolated. Do not migrate or overwrite existing phone values.
- Supply desktop preference scope through the nested desktop layout to shared UI, while leaving ordinary phone consumers on their existing scope. Non-React readers receive an explicit scope where necessary; never use screen width to select permissions.
- Ensure desktop data, navigation, send/receive asset selection, Swap and desktop settings use the same desktop choices. Keep the shared payment and signing implementations unchanged.
- Update architecture rules and add focused tests for desktop defaults, phone-value preservation, profile isolation, explicit desktop opt-outs and retained execution restrictions.

## Verification and delivery
- Check an unlocked isolated wallet: DOGE/LTC form, network/destination options, provider comparison with non-spending input, saved settings, profile switching and desktop send/receive navigation.
- Check the phone view and packaged-build platform guards; no funded payment or swap will be sent.
- Return an updated auditor-shareable source and test pack. Do not publish or rebuild release packages during this task.