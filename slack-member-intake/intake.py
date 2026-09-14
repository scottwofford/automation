"""Seattle AI Safety newcomer intake. Local draft mode is the default."""
import hashlib
import os
from pathlib import Path
import sqlite3
from threading import RLock

WELCOME = """Welcome to Seattle AI Safety! I'm Scott's intake bot. If you'd like, reply with:
• What you're working on and your AI safety interests
• A public professional profile or website
• Help you're looking for or could offer

All questions are optional. Scott can read your replies; they won't be added to a shared directory without your permission. Please don't include sensitive personal information. Reply DELETE to ask the bot to remove its saved replies, or contact Scott directly. No response needed if you'd rather skip this."""
WELCOME_HASH = hashlib.sha256(WELCOME.encode()).hexdigest()


class Intake:
    def __init__(self, path, team_id, activated_at, send=None):
        self.team_id = team_id
        self.activated_at = activated_at
        self.send = send
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(path, check_same_thread=False)
        os.chmod(path, 0o600)
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS newcomers (
                team_id TEXT, user_id TEXT, event_id TEXT, observed_at INTEGER,
                state TEXT, channel_id TEXT, PRIMARY KEY(team_id, user_id));
            CREATE TABLE IF NOT EXISTS replies (
                team_id TEXT, user_id TEXT, channel_id TEXT, message_ts TEXT,
                text TEXT, observed_at INTEGER,
                PRIMARY KEY(team_id, channel_id, message_ts));
        """)

    def join(self, body):
        event = body.get('event', {})
        user = event.get('user', {})
        observed = body.get('event_time', 0)
        if (body.get('team_id') != self.team_id or event.get('type') != 'team_join'
                or not body.get('event_id') or not user.get('id')
                or observed < self.activated_at or user.get('is_bot')
                or user.get('team_id', self.team_id) != self.team_id
                or user.get('is_stranger') or user.get('is_restricted')
                or user.get('is_ultra_restricted')
                or user.get('deleted') or user.get('id') == 'USLACKBOT'):
            return 'ignored'
        # Persist the claim BEFORE contacting Slack. A crash or timeout must not
        # cause a duplicate welcome. Uncertain sends require human inspection.
        state = 'pending' if self.send else 'draft'
        with self.db:
            result = self.db.execute(
                'INSERT OR IGNORE INTO newcomers VALUES (?, ?, ?, ?, ?, NULL)',
                (self.team_id, user['id'], body['event_id'], observed, state))
        if result.rowcount == 0:
            return 'duplicate'
        if self.send:
            try:
                channel = self.send(user['id'], WELCOME)
            except Exception:
                with self.db:
                    self.db.execute('UPDATE newcomers SET state=? WHERE team_id=? AND user_id=?',
                                    ('uncertain', self.team_id, user['id']))
                return 'uncertain'
            with self.db:
                self.db.execute('UPDATE newcomers SET state=?, channel_id=? WHERE team_id=? AND user_id=?',
                                ('sent', channel, self.team_id, user['id']))
        return state if not self.send else 'sent'

    def reply(self, body):
        event = body.get('event', {})
        if body.get('team_id') != self.team_id or event.get('channel_type') != 'im':
            return 'ignored'
        channel = event.get('channel')
        subtype = event.get('subtype')
        if subtype == 'message_deleted':
            with self.db:
                self.db.execute('DELETE FROM replies WHERE team_id=? AND channel_id=? AND message_ts=?',
                                (self.team_id, channel, event.get('deleted_ts')))
            return 'deleted'
        message = event.get('message', {}) if subtype == 'message_changed' else event
        if subtype not in (None, 'message_changed') or message.get('bot_id'):
            return 'ignored'
        user = message.get('user')
        known = self.db.execute('SELECT 1 FROM newcomers WHERE team_id=? AND user_id=? AND channel_id=? AND state=?',
                               (self.team_id, user, channel, 'sent')).fetchone()
        if not known or not message.get('ts') or not isinstance(message.get('text'), str):
            return 'ignored'
        with self.db:
            if message['text'].strip().upper() == 'DELETE':
                self.db.execute('DELETE FROM replies WHERE team_id=? AND user_id=?', (self.team_id, user))
                return 'deleted'
            # Keep one current version per Slack message, including edits. Never
            # publish these private replies to Git or a shared directory.
            self.db.execute('INSERT OR REPLACE INTO replies VALUES (?, ?, ?, ?, ?, ?)',
                            (self.team_id, user, channel, message['ts'], message['text'], body.get('event_time', 0)))
        return 'saved'


def main():
    from slack_bolt import App
    from slack_bolt.adapter.socket_mode import SocketModeHandler
    from slack_sdk import WebClient

    # Socket Mode uses Slack's authenticated WebSocket, so no public HTTP
    # endpoint or home-grown HTTP signature validation is needed.
    os.umask(0o077)
    team = os.environ['SLACK_TEAM_ID']
    activated = int(os.environ['INTAKE_ACTIVATED_AT'])
    # Disable automatic API retries: a network failure may occur after Slack
    # accepted a welcome, and retrying could send the same message twice.
    app = App(client=WebClient(token=os.environ['SLACK_BOT_TOKEN'], retry_handlers=[]))
    identity = app.client.auth_test()
    if identity.get('team_id') != team:
        raise SystemExit('Configured workspace does not match bot token.')

    def send(user, text):
        channel = app.client.conversations_open(users=user)['channel']['id']
        app.client.chat_postMessage(channel=channel, text=text, unfurl_links=False, unfurl_media=False)
        return channel

    # Enabling sends requires BOTH an explicit exception to Scott's standing
    # no-send rule and a hash matching the exact reviewed welcome text.
    enabled = os.environ.get('INTAKE_SEND_APPROVED') == 'yes'
    if enabled and os.environ.get('INTAKE_APPROVED_WELCOME_SHA256') != WELCOME_HASH:
        raise SystemExit('Welcome text has not been approved.')
    state = Path(os.environ.get('INTAKE_STATE_DIR', '~/.local/share/slack-member-intake')).expanduser()
    intake = Intake(state / 'intake.sqlite3', team, activated, send if enabled else None)
    # Bolt invokes handlers on worker threads; serialize access to the local
    # database so overlapping join/reply events cannot race each other.
    lock = RLock()

    @app.event('team_join')
    def on_join(body):
        with lock:
            print('join:', intake.join(body), flush=True)

    @app.event('message')
    def on_message(body):
        with lock:
            print('reply:', intake.reply(body), flush=True)

    # Log only fixed failure statuses, never tokens, profiles, or message text.
    @app.error
    def on_error(error):
        print('event: failed', flush=True)

    SocketModeHandler(app, os.environ['SLACK_APP_TOKEN']).start()


if __name__ == '__main__':
    main()
