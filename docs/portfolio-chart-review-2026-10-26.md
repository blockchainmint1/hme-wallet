# Portfolio chart update review — 2026-10-26

## Findings and changes
- The prior Y axis included zero, hiding small changes around a large balance. The chart now uses observed minimum/maximum values with explicit padding and nonnegative bounds.
- Range buttons previously filtered data but stretched those same recent points across identical data-min/data-max axes. The axes now span the selected rolling day/week/month/year; ALL spans recorded history. Missing older data remains empty, not fabricated.
- Complete balance changes previously waited for the five-minute interval. Changed totals now record immediately after a complete data update; unchanged values remain throttled to five minutes. Non-increasing timestamps are rejected. The 2,000-point retention cap remains.
- Axis time updates every minute while mounted. Day view uses time labels; longer windows use dates.

## Preserved boundaries
No new network requests, price sources, migrations, signing, orders or spending permissions. Existing exact coverage, profile/fingerprint isolation, history deletion and incomplete-balance refusal remain. Shared source carries this change into future web/APK/extension releases; phone presentation is unchanged. Existing historical observations are not rewritten.

## Verification
- `bunx vitest run src/lib/desktop/history.test.ts src/lib/desktop/currency-history.test.ts`: 17 tests pass.
- Preview build log: build OK after chart edits.
- Browser mounted the actual Portfolio component with controlled balance data and stubbed data provider, navigation and unrelated sections. Day/month axes differed, and an increase from $475,440.40 to $475,540.40 was immediately appended and shown. Screenshots inspected.
- This isolated browser check is not an authenticated end-to-end check against Bobby's wallet or live network refresh. No wallet keys or real funds used.

## Independent review focus
Review increased sample frequency for changed values versus existing 2,000-point retention; high price-update frequency can reduce retained time span. Review zero/constant-value domain padding, coverage filtering and ALL boundary behavior. Check the real wallet's refresh and privacy controls before release.

Nothing published or packaged. No past history can be recovered from these changes.