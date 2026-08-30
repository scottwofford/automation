# Seattle AI Safety Slack invite refresh

Renews the public Seattle AI Safety Slack invitation three days before Slack's 30-day expiry, then updates [the public Slack page](https://luthien.cc/slack/).

## Safety model

- The Chromium profile lives at `~/.local/share/seattle-slack-invite-refresh/playwright-profile`, outside Git and with owner-only permissions.
- Browser automation accepts only the `seattleaisafety` workspace.
- A candidate link must be publicly active, belong to Seattle AI Safety, extend the current expiry, and have 20 to 31 days remaining.
- The automation never deactivates the current link.
- Logs contain fixed status codes, not cookies, page contents, or invite tokens.
- Only one refresh can run at a time.

## Setup

```bash
cd ~/build/automation/slack-invite-refresh
npm ci
npx playwright install chromium
npm run login
```

Sign in to Seattle AI Safety in the dedicated Chromium window, then close it. Use a dedicated, least-privilege Slack administrator identity if the workspace supports one. Keep a second human workspace owner for recovery.

After login, inspect the authenticated invite controls without changing Slack:

```bash
npm run observe
```

The first authenticated observation is a required calibration step. `npm run run` fails closed with `SLACK_UI_NOT_CALIBRATED` until the observed Slack interface proves a safe pre-expiry operation. It will not deactivate the live link to manufacture a replacement.

Create a fine-grained GitHub token limited to `LuthienResearch/luthien-pbc-site` with Contents and Pull requests read/write and Checks read. Store it in macOS Keychain without placing it in a file or shell history:

```bash
npm run configure-github
```

The renewal creates a branch containing only `site/slack/invite.json`, opens a pull request, waits for checks, merges it, and verifies the exact configuration on production. A pending Slack candidate is saved outside Git so a failed publish resumes without creating another invitation.

## Schedule

The launch agent does not run Chromium daily. It sleeps until three days before the live invite's exact `expiresAt`, refreshes once, then derives the next run from Slack's new expiry. If the Mac is asleep, it runs after the user session resumes. The six-hour GitHub monitor on the site repository remains the independent backstop.

Install the agent only after Slack and GitHub calibration are complete:

```bash
npm run install-agent
```

## Manual checks

```bash
npm test
npm run check
npm run run
```

Slack documents that invite links expire after 30 days and that workspace owners and administrators can manage or renew them:

- [Invite new members to your workspace](https://slack.com/help/articles/201330256-Invite-new-members-to-your-workspace-Invite-new-members-to-your-workspace)
- [Manage pending invitations and invite links](https://slack.com/help/articles/360060363633-Manage-pending-invitations-and-invite-links-for-your-workspace)
