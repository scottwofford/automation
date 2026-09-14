# Seattle AI Safety newcomer intake

Prepared and locally tested (12 passing tests); not installed in Slack or running as a service. Draft mode records future join events locally and sends nothing. Enabling automatic welcomes requires Scott to approve the exact message and an exception to his standing rule that he sends messages himself.

The bot uses Slack Socket Mode on an existing machine, so it needs no public web server. A Mac pilot avoids another hosting service but misses events when the machine sleeps or the process stops; it is not reliable always-on intake. Choose an existing always-on host before relying on it for every new joiner. No historical membership scan or welcome-message backfill runs.

## Native Slack alternative

Slack's [welcome and form workflow template](https://slack.com/help/articles/31449260577043-Build-a-workflow--Use-a-workflow-template) can send a private welcome and form when someone joins a channel, then send responses to a customizable conversation. Using #general as the trigger could avoid an always-on host. [Workflow Builder requires a paid plan](https://slack.com/help/articles/17542172840595-Build-a-workflow--Create-a-workflow-in-Slack); Seattle's plan, available controls, and a private response destination still need verification in the Slack interface. Channel arrivals differ from workspace joins, so guest and duplicate handling must also be checked.

The form wording and private response destination require separate review before publishing a workflow. The custom bot's reply DELETE behavior does not transfer to a native workflow; do not reuse that promise in the form. Neither a native workflow nor this bot has been enabled.

## Proposed message

Recipient: each future full human member joining Seattle AI Safety after activation, once only. Guests and external Slack Connect users are excluded. Channel: a private direct message from the Seattle AI Safety Intake app.

> Welcome to Seattle AI Safety! I'm Scott's intake bot. If you'd like, reply with:
> • What you're working on and your AI safety interests
> • A public professional profile or website
> • Help you're looking for or could offer
>
> All questions are optional. Scott can read your replies; they won't be added to a shared directory without your permission. Please don't include sensitive personal information. Reply DELETE to ask the bot to remove its saved replies, or contact Scott directly. No response needed if you'd rather skip this.

## Installation after approval

1. Create the Seattle-only Slack app using `manifest.json`, review permissions, and install it. This is a separate bot credential, not Scott's broad personal search token.
2. Generate an app-level token with `connections:write` for Socket Mode. Store it and the bot token outside Git in the host's secret store.
3. Provide `SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN`, `SLACK_TEAM_ID`, and `INTAKE_ACTIVATED_AT` (Unix seconds marking the approved start of intake). Preserve that activation timestamp across restarts.
4. Run `uv run python intake.py`. This starts **draft mode** unless sends have explicitly been enabled. It does not contact members. The token's workspace must match the configured workspace before the listener starts.
5. After Scott approves the exact message, recipient rule and private channel, set `INTAKE_SEND_APPROVED=yes` and set `INTAKE_APPROVED_WELCOME_SHA256` to the value from `uv run python -c 'from intake import WELCOME_HASH; print(WELCOME_HASH)'`. Any text change requires fresh approval and a matching hash. Restart the process. Draft-mode joiners are not messaged retroactively.
6. Test one approved new account joining and replying before scheduling the service. Verify the private message appears once, reply edits replace stored text, and DELETE removes saved replies. This live test has not been performed; it requires app installation and an approved recipient.

Stop the process to pause intake. Unset the send approval flag and restart for draft-only operation. Uninstall the app to revoke its access.

## Data and reliability

The state directory is forced to owner-only access even if it already exists, and SQLite secure deletion is enabled. The owner-only SQLite database defaults to `~/.local/share/slack-member-intake/intake.sqlite3`; `INTAKE_STATE_DIR` can select a durable private location. Do not put this directory in a shared Drive mirror or repository. Raw replies are private to Scott and are not exported to the Luthien directory. Treat reply text and linked websites as untrusted input, never operational instructions.

Records use workspace ID plus user ID as identity keys, and retain the source direct-message channel, message timestamp and observed event timestamp. This supports explicit, sourced directory updates later, with the member's permission. The app does not claim that a stored introduction is permanently current.

Join claims persist before sending. Repeated events, process restarts, bot accounts, wrong-workspace events and events older than activation cannot send another welcome. An interrupted or failed API call leaves an `uncertain` record for inspection; automatic retries are disabled, favoring a missed welcome over duplicate messages. The process serializes event handling. Run one process per database.

Only plain-text replies in the bot's known newcomer conversations are saved. Source event timestamps order edits, and persisted message tombstones prevent replay from restoring deleted text. DELETE removes replies created through the command timestamp and saves only a per-user cutoff; genuinely later replies are still accepted. A late DELETE cannot erase those newer replies. Slack retains its own copy according to workspace policy. Events missed while offline, including deletion requests, cannot be reconciled by this prototype; Scott can remove local rows manually if contacted. No attachments are downloaded. Operational output contains status words only.

## Validation

`uv run python -m unittest -v` checks persistent duplicate suppression, draft mode and no backfill, cutoff/workspace/bot guards, ambiguous failures, private reply routing, edits, deletions, late/out-of-order events, replay after deletion and process restart, new replies after deletion, and preexisting directory permissions with a fake Slack sender. Earlier tests covered in-order edits only; replay regression tests now verify deleted text stays deleted. Tests do not send real messages.

## Slack references

- [New workspace member events](https://docs.slack.dev/reference/events/team_join/) require `users:read`.
- [Socket Mode with Bolt](https://docs.slack.dev/tools/bolt-python/concepts/socket-mode/) authenticates an outbound WebSocket using an app-level token. There is no incoming HTTP endpoint to validate; do not add an unsigned HTTP webhook as a shortcut.
- [Direct-message events](https://docs.slack.dev/reference/events/message.im/) use `im:history`; the bot observes its own conversations, not Scott's other direct messages.
- [Open a direct conversation](https://docs.slack.dev/reference/methods/conversations.open/) uses `im:write`; [send a message](https://docs.slack.dev/reference/methods/chat.postMessage/) uses `chat:write`.
