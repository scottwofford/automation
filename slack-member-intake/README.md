# Seattle AI Safety newcomer welcome bot

The approved welcome is enabled on Scott's Mac as a login service. Scott approved the exact message and automatic direct messages to future new members on September 14, 2026. The app is currently named Demo App in Slack. It asks people to post publicly in #intros; it does not collect or store private replies.

## Approved message

> Welcome to Seattle AI Safety. There are apparently several of us. I’m a bot helping [Scott](https://scottwofford.com/) and [Jai](https://www.jai.one/) welcome new members.
> 
> Please post something in **#intros** such as something you've done, made or are working on plus your favorite AI or AI safety meme.
> 
> Also, if you know anyone else based in Seattle who’s AI safety-pilled, please either invite them or share their name so we can reach out to them.

## Operation

Slack Socket Mode receives `team_join` events. Each full human member joining Seattle AI Safety after the saved activation time receives one private welcome. Bot accounts, guests, Slack Connect strangers, wrong-workspace events, and pre-activation events are excluded. The #intros link points to the verified public channel C0C1Y2U8QTE.

`run_local.py` loads credentials from `~/.config/slack-member-intake/credentials.env` and approval settings from `runtime.env` in the same directory. Both files require owner-only permissions. Credentials never enter Git or process arguments. Runtime settings hold the original activation timestamp and approved message hash. Preserve the timestamp across restarts. Changing message text invalidates approval until a newly approved hash is configured.

The launch agent is `~/Library/LaunchAgents/org.seattleaisafety.newcomer-bot.plist`. It runs the pinned virtual environment and restarts the process after failure or login. Logs are in `~/Library/Logs/slack-member-intake/`. Stop with:

```sh
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/org.seattleaisafety.newcomer-bot.plist
```

Start again with `launchctl bootstrap` and the same arguments. Remove the launch-agent file to disable future automatic starts.

This is a Mac-hosted deployment: it cannot process events while the machine sleeps or is offline. Slack's delayed-event option was enabled in the configuration screenshot, but delayed recovery has not been live-tested and does not guarantee delivery. Reliable continuous operation requires an always-on host.

## Data and delivery

An owner-only SQLite database in `~/.local/share/slack-member-intake/` records member IDs, event IDs, timestamps, direct-message channel IDs, and delivery status. Claims are saved before sending to prevent duplicates after retries or crashes. Ambiguous sends become `uncertain` and are not automatically retried. This favors avoiding duplicate welcomes over guaranteed delivery.

The runtime acknowledges direct-message events without saving or replying to them. The legacy private-reply storage helper remains in the module and regression tests but is not connected to any runtime event handler. The bot does not monitor public introductions or update the people directory.

## Validation

September 14, 2026: both credentials authenticated; all four required bot scopes verified; a live Socket Mode connection received Slack's hello packet; the approved public #intros target was verified; 12 unit tests passed; the launch agent reported running and Bolt reported startup without a traceback. No synthetic welcome was sent to a real person. End-to-end receipt by a new member remains unverified until a genuine future join or separately approved test.

Tests cover duplicate prevention, persisted state, cutoff/workspace/account guards, ambiguous send outcomes, and the legacy reply/deletion behavior. Run `uv run python -m unittest -q`.

## Slack setup

Required bot scopes: `users:read`, `chat:write`, `im:write`, `im:history` (the final scope supports the currently subscribed but ignored direct-message events). App-level scope: `connections:write`. Socket Mode and Event Subscriptions are enabled. The existing app shares its installation with Scott's separate user-token research connection; the bot process uses only the bot and app-level tokens.

References: [team_join](https://docs.slack.dev/reference/events/team_join/), [Socket Mode](https://docs.slack.dev/tools/bolt-python/concepts/socket-mode/), [opening direct messages](https://docs.slack.dev/reference/methods/conversations.open/), [sending messages](https://docs.slack.dev/reference/methods/chat.postMessage/).
