"""Seattle AI Safety newcomer intake. Local draft mode is the default."""
from decimal import Decimal, InvalidOperation
import hashlib
import os
from pathlib import Path
import sqlite3
from threading import RLock

WELCOME = """Welcome to Seattle AI Safety. There are apparently several of us. I’m a bot helping <https://scottwofford.com/|Scott> and <https://www.jai.one/|Jai> welcome new members.

Please post something in <#C0C1Y2U8QTE> such as something you've done, made or are working on plus your favorite AI or AI safety meme.

Also, if you know anyone else based in Seattle who’s AI safety-pilled, please either invite them or share their name so we can reach out to them."""
WELCOME_HASH = hashlib.sha256(WELCOME.encode()).hexdigest()


class Intake:
    def __init__(self, path, team_id, activated_at, send=None):
        self.team_id = team_id
        self.activated_at = activated_at
        self.send = send
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(path.parent, 0o700)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute("PRAGMA secure_delete = ON")
        os.chmod(path, 0o600)
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS newcomers (
                team_id TEXT, user_id TEXT, event_id TEXT, observed_at INTEGER,
                state TEXT, channel_id TEXT, PRIMARY KEY(team_id, user_id));
            CREATE TABLE IF NOT EXISTS message_versions (
                team_id TEXT, channel_id TEXT, message_ts TEXT, version_ts TEXT, deleted INTEGER,
                PRIMARY KEY(team_id, channel_id, message_ts));
            CREATE TABLE IF NOT EXISTS deletion_cutoffs (
                team_id TEXT, user_id TEXT, cutoff_ts TEXT, PRIMARY KEY(team_id, user_id));
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
        # Use Slack's source timestamps, not delivery order. Replayed events
        # must never restore deleted text or replace a newer version.
        message = event.get('message', {}) if subtype == 'message_changed' else event
        message_ts = event.get('deleted_ts') if subtype == 'message_deleted' else message.get('ts')
        version_ts = (message.get('edited', {}).get('ts')
                      or ((event.get('event_ts') or body.get('event_time')) if subtype else message_ts))
        try:
            created, version = Decimal(str(message_ts)), Decimal(str(version_ts))
            if not created.is_finite() or not version.is_finite():
                return 'ignored'
        except InvalidOperation:
            return 'ignored'
        key = (self.team_id, channel, message_ts)
        previous = self.db.execute(
            'SELECT version_ts, deleted FROM message_versions WHERE team_id=? AND channel_id=? AND message_ts=?', key).fetchone()
        if previous and (previous[1] or Decimal(previous[0]) > version
                         or (Decimal(previous[0]) == version and subtype != 'message_deleted')):
            return 'ignored'
        if subtype == 'message_deleted':
            known = self.db.execute('SELECT 1 FROM newcomers WHERE team_id=? AND channel_id=? AND state=?',
                                    (self.team_id, channel, 'sent')).fetchone()
            if not known:
                return 'ignored'
            with self.db:
                self.db.execute('DELETE FROM replies WHERE team_id=? AND channel_id=? AND message_ts=?', key)
                self.db.execute('INSERT OR REPLACE INTO message_versions VALUES (?, ?, ?, ?, 1)', (*key, str(version)))
            return 'deleted'
        if subtype not in (None, 'message_changed') or message.get('bot_id'):
            return 'ignored'
        user = message.get('user')
        known = self.db.execute('SELECT 1 FROM newcomers WHERE team_id=? AND user_id=? AND channel_id=? AND state=?',
                               (self.team_id, user, channel, 'sent')).fetchone()
        if not known or not isinstance(message.get('text'), str):
            return 'ignored'
        cutoff_row = self.db.execute('SELECT cutoff_ts FROM deletion_cutoffs WHERE team_id=? AND user_id=?',
                                     (self.team_id, user)).fetchone()
        cutoff = Decimal(cutoff_row[0]) if cutoff_row else Decimal('-Infinity')
        with self.db:
            if message['text'].strip().upper() == 'DELETE':
                cutoff = max(cutoff, version)
                self.db.execute('INSERT OR REPLACE INTO deletion_cutoffs VALUES (?, ?, ?)',
                                (self.team_id, user, str(cutoff)))
                # Keep later, genuinely new replies even if the DELETE event
                # arrives late. Only IDs and timestamps survive deletion.
                rows = self.db.execute('SELECT channel_id, message_ts FROM replies WHERE team_id=? AND user_id=?',
                                       (self.team_id, user)).fetchall()
                for saved_channel, saved_ts in rows:
                    if Decimal(saved_ts) <= cutoff:
                        self.db.execute('DELETE FROM replies WHERE team_id=? AND channel_id=? AND message_ts=?',
                                        (self.team_id, saved_channel, saved_ts))
                self.db.execute('INSERT OR REPLACE INTO message_versions VALUES (?, ?, ?, ?, 1)', (*key, str(version)))
                return 'deleted'
            if created <= cutoff:
                return 'ignored'
            self.db.execute('INSERT OR REPLACE INTO message_versions VALUES (?, ?, ?, ?, 0)', (*key, str(version)))
            # Keep one current version per Slack message, including edits. Never
            # publish these private replies to Git or a shared directory.
            self.db.execute('INSERT OR REPLACE INTO replies VALUES (?, ?, ?, ?, ?, ?)',
                            (self.team_id, user, channel, message_ts, message['text'], body.get('event_time', 0)))
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
        # Introductions belong in the public channel. Acknowledge subscribed
        # direct-message events without saving replies or sending a response.
        pass

    # Log only fixed failure statuses, never tokens, profiles, or message text.
    @app.error
    def on_error(error):
        print('event: failed', flush=True)

    SocketModeHandler(app, os.environ['SLACK_APP_TOKEN']).start()


if __name__ == '__main__':
    main()
