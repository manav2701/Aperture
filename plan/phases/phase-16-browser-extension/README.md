# Phase 16 — Browser extension for AI tool discovery and steering

**Goal:** see AI tools used in the browser that no admin API, receipt, or statement reveals, and steer people to the approved ones. The extension records **which AI sites are used, by whom, and for how long**. It never reads what people type or what the AI answers.

**Duration:** ~3 weeks, plus store review time.
**Depends on:** Phase 12 (AI tool catalogue, approved-tools list, seats, onboarding screen).
**Needs from you:** a Chrome Web Store developer account (one-time fee) and a Microsoft Edge Add-ons account; a test Google Workspace or Microsoft Intune tenant to try managed installs.

## Why this phase

Phase 12 covers seats with admin APIs, receipts, declarations, and terminal tools. What's left is browser use of tools nobody declared: a free Claude account, a new AI writing site, a personal ChatGPT login next to the company seat. IBM and Credo sell "shadow AI detection" on their front pages; this is ours, built privacy-first.

## Scope

**In:** a Manifest V3 extension for Chrome and Edge; managed install by the company; domain-level detection from the tool catalogue; work vs. personal account hints where the page shows them; nudges to approved tools; optional blocking of unapproved tools by org policy; a privacy notice.

**Out:** capturing prompts, responses, page content, or screenshots; Firefox and Safari (later if asked); mobile.

## Tasks

### 16.1 Detection

- The extension downloads the AI tool catalogue's domain list (signed by Aperture, refreshed daily) and matches visited domains locally.
- It reports per day: tool, minutes active (tab focused), and number of visits. **Nothing else** leaves the browser: no URLs beyond the matched domain, no page text.
- **Account hint:** for the main tools, whether the session looks like the company workspace or a personal account (for example from the workspace name shown in the page). **VERIFY** per tool that this is possible without reading conversation content; skip it where it isn't.

### 16.2 Steering and policy

- Visiting an unapproved tool shows a small banner: "Your company provides Claude Team. Open it instead?" with a link. Members can dismiss it.
- Optional org policy **block** for specific unapproved tools (declarativeNetRequest rules), with a "request access" button that creates an approval in Aperture.
- Results feed Phase 12 seats, posture (`tools.unapproved`, `extension.coverage`), inventory, and coverage.

### 16.3 Install and identity

- **Managed install** through Google Workspace (Chrome) or Microsoft Intune (Edge), with the org id pushed as managed configuration, so members don't sign in.
- **Self install** from the onboarding screen: the member signs in with their Aperture account.
- The member can always see what the extension reported about them (a page in the workspace).

### 16.4 Privacy and trust

- A plain-language privacy notice in the extension and on the website: what is collected (domains from the AI catalogue, time, visits), what is not (everything else).
- Minimal permissions; the catalogue match is local; reports are batched daily.
- A works-council / employee-notice template for customers in jurisdictions that need one. **VERIFY** UAE PDPL and DIFC data protection requirements with counsel.

## Edge cases

- **B1** The extension is removed → coverage drops and posture shows `extension.coverage` falling; no data is invented.
- **B2** A tool changes domain → catalogue update; unmatched AI-like domains are never reported (no guessing from page content).
- **B3** A personal browser profile on a work machine → only managed profiles report under managed install.

## Tests

- Unit tests for matching and batching; a test that the report payload contains only the allowed fields; end-to-end with Playwright loading the unpacked extension; store pre-review checklist.

## Security checklist

- [ ] Only matched catalogue domains and time are reported (test-enforced on the payload)
- [ ] The catalogue is signed; the extension refuses an unsigned or tampered list
- [ ] Minimal permissions, justified in the store listing
- [ ] Counsel-approved privacy notice

## Try it yourself

1. Install the unpacked extension, open claude.ai and a non-approved AI site → the next day's report shows both, with minutes.
2. Mark one tool as blocked → visiting it shows the block page with "request access"; approving in Aperture lifts it.

## Exit criteria

- [ ] Extension in the Chrome Web Store and Edge Add-ons (unlisted is fine for the pilot)
- [ ] Managed install tested on one Workspace or Intune tenant
- [ ] Reports feeding seats, posture, and coverage
- [ ] ADR 0025 written; privacy notice approved
