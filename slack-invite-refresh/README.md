# Seattle AI Safety Slack invite refresh

Renews the public Seattle AI Safety Slack invitation one minute after Slack's 30-day expiry, then updates [the public Slack page](https://luthien.cc/slack/).

## Safety model

- The Chromium profile lives at `~/.local/share/seattle-slack-invite-refresh/playwright-profile`, outside Git and with owner-only permissions.
- Browser automation accepts only the `seattleaisafety` workspace.
- Slack must renew the same `seattleaisafety` URL for another 20 to 31 days.
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

The automation targets the row whose token exactly matches the production URL. It clicks Renew only when that row says it is expired, and it never clicks Deactivate.

The renewal uses the existing GitHub CLI login to create a branch containing only `site/slack/invite.json`, open a pull request, wait for checks, merge it, and verify the exact configuration on production. A pending renewal is saved outside Git so a failed publish resumes without clicking Renew again.

## Schedule

The launch agent does not run Chromium daily. It sleeps until one minute after the live invite's exact `expiresAt`, renews it once, then derives the next run from Slack's new expiry. If the Mac is asleep, it runs after the user session resumes. The six-hour GitHub monitor on the site repository remains the independent backstop.

Install the agent after Slack login:

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
