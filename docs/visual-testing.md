# Screenshot verification and demo privacy

Documentation images are captured from **`npm run demo`**, on `http://127.0.0.1:4311`. All names, notes, addresses, observations, and prices in that process come from `lib/demo/fixture.mjs`. The prices are illustrative budgets, not provider quotes.

The demo uses the real UI, routes, validation, and fleet service, but has:

- An in-memory registry that resets on process restart.
- A synthetic checker, including when a new server is added or **Check now** is pressed.
- Disabled billing and no reading of `.env`, local config, AWS credentials, DigitalOcean tokens, or the user's registry.
- Reserved example domains and explicit example-data labeling.

The ordinary app's ignored `data/` and `test-results/` folders may contain private test data or earlier private captures. They are not documentation assets. Never copy those captures into the README. Only reviewed demo images under `docs/images/` are referenced there.

## Repeat the browser checks

1. Run `npm ci`, then `npm run demo`. Use `npm run demo -- 4321` if the demo port is occupied.
2. Verify the example-data banner and four invented servers. AWS and DigitalOcean billing should say **Not connected** and **Refresh billing** should be disabled.
3. Select **Needs attention**: only Atlas worker should remain. Select **All servers**, then search for Harbor: only Harbor API should remain. Clear search.
4. Edit Harbor API's cost from 18 to 20. The total should change from USD 64.00 to USD 66.00. Restore 18. No network billing query should occur.
5. Pause and resume Harbor API. Its history should remain; paused metrics must be labeled as the last observation.
6. In Workspace settings, change the interval to one minute, save, verify it, then restore 30 seconds. The displayed registry location should identify the in-memory demo, without a personal filesystem path.
7. Add a server named Demo gateway using `https://gateway.example.test/health`. The form must switch from SSH fields to HTTP fields. Save it and verify a synthetic observation. Remove that temporary record.
8. Reload. Inspect the overview, card layout, cost dialog, and browser console. Restart the demo to reset any fixture edits before capturing documentation.

## Capture record

Desktop browser checks completed on 2026-10-22 in the in-app browser. The flows above were exercised with actual UI controls, screenshots were visually inspected, and the browser reported no console warnings/errors. The pause/resume check exposed a check-field-order bug; the service now uses structural comparison, with a regression test.

The documentation captures show the overview, the fleet, and the editable cost dialog. The fleet image was replaced with a landscape capture showing its complete heading and three full server cards, including resource usage, notes, and costs. They are ordinary screenshots, not generated mockups. `docs/images/manifest.json` records their hashes and fictional-demo provenance. `npm run docs:check` validates the README image references, hashes, and—when the default local registry is present—checks documentation text and demo sources for its server identifiers. Hashes and text checks do not perform OCR; the privacy guarantee also depends on capture isolation and visual inspection.

The 2026-10-22 verification run covered the desktop viewport only. There is no automated pixel-diff regression suite and no claim of mobile browser coverage. Live SSH and paid cloud billing APIs are outside this screenshot run.

## Rename verification — 2026-10-29

Refreshed all three documentation screenshots from the isolated fictional demo after renaming the app to **Small Server OB**. Verified the new page title and sidebar label, the Needs attention filter, Harbor search, and editing Harbor's monthly estimate from 18 to 20 (fleet total 64 to 66), then restored 18. Billing remained disconnected. The overview, complete first row of fleet cards, and cost editor were visually inspected; the browser reported no console warnings or errors.

Checked the logo at the default desktop width and a 1000-pixel viewport, plus the overview at a 390-pixel viewport. The logo fit the compact sidebar and the phone-width overview had no horizontal overflow. This is limited responsive layout coverage, not a full mobile interaction suite. Temporary viewport overrides were reset after testing. No real server or billing credentials were used.
