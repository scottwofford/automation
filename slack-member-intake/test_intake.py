import tempfile
import unittest
from pathlib import Path
from intake import Intake, WELCOME


class IntakeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'intake.sqlite3'
        self.calls = []
        self.bot = Intake(self.path, 'T1', 100, self.send)

    def tearDown(self):
        self.bot.db.close()
        self.tmp.cleanup()

    def send(self, user, text):
        self.calls.append((user, text))
        return 'D1'

    def join(self, **changes):
        body = {'team_id': 'T1', 'event_id': 'E1', 'event_time': 101,
                'event': {'type': 'team_join', 'user': {'id': 'U1'}}}
        body.update(changes)
        return body

    def reply(self, **changes):
        event = {'type': 'message', 'channel_type': 'im', 'channel': 'D1',
                 'user': 'U1', 'ts': '105.1', 'text': 'Working on evaluations'}
        event.update(changes)
        return {'team_id': 'T1', 'event_time': 105, 'event': event}

    def test_duplicates_survive_restart_and_different_event_ids(self):
        self.assertEqual(self.bot.join(self.join()), 'sent')
        self.bot.db.close()
        self.bot = Intake(self.path, 'T1', 100, self.send)
        self.assertEqual(self.bot.join(self.join(event_id='E2')), 'duplicate')
        self.assertEqual(self.calls, [('U1', WELCOME)])

    def test_old_wrong_workspace_and_bot_events_do_not_send(self):
        for body in [self.join(event_time=99), self.join(team_id='T2'),
                     self.join(event={'type': 'team_join', 'user': {'id': 'B1', 'is_bot': True}})]:
            self.assertEqual(self.bot.join(body), 'ignored')
        self.assertEqual(self.calls, [])

    def test_draft_mode_does_not_send_or_backfill_on_enable(self):
        self.bot.send = None
        self.assertEqual(self.bot.join(self.join()), 'draft')
        self.bot.send = self.send
        self.assertEqual(self.bot.join(self.join()), 'duplicate')
        self.assertEqual(self.calls, [])

    def test_external_users_guests_and_channel_arrivals_do_not_send(self):
        for fields in [{'team_id': 'T2'}, {'is_stranger': True},
                       {'is_restricted': True}, {'is_ultra_restricted': True}]:
            self.assertEqual(self.bot.join(self.join(event={
                'type': 'team_join', 'user': {'id': 'U1', **fields}})), 'ignored')
        self.assertEqual(self.bot.join(self.join(event={
            'type': 'member_joined_channel', 'user': {'id': 'U1'}})), 'ignored')
        self.assertEqual(self.calls, [])

    def test_ambiguous_failure_is_not_retried(self):
        def fail(user, text):
            self.calls.append(user)
            raise TimeoutError()
        self.bot.send = fail
        self.assertEqual(self.bot.join(self.join()), 'uncertain')
        self.assertEqual(self.bot.join(self.join()), 'duplicate')
        self.assertEqual(len(self.calls), 1)

    def test_reply_edit_delete_and_foreign_messages(self):
        self.assertEqual(self.bot.reply(self.reply()), 'ignored')
        self.bot.join(self.join())
        self.assertEqual(self.bot.reply(self.reply(channel='D2')), 'ignored')
        self.assertEqual(self.bot.reply(self.reply()), 'saved')
        self.bot.reply(self.reply(subtype='message_changed', message={
            'user': 'U1', 'ts': '105.1', 'text': 'Updated introduction'}))
        self.assertEqual(self.bot.db.execute('SELECT text FROM replies').fetchall(), [('Updated introduction',)])
        self.bot.reply(self.reply(subtype='message_deleted', deleted_ts='105.1'))
        self.assertEqual(self.bot.db.execute('SELECT count(*) FROM replies').fetchone()[0], 0)

    def test_delete_command_removes_saved_replies(self):
        self.bot.join(self.join())
        self.bot.reply(self.reply())
        self.assertEqual(self.bot.reply(self.reply(ts='106.1', text='DELETE')), 'deleted')
        self.assertEqual(self.bot.db.execute('SELECT count(*) FROM replies').fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main()
