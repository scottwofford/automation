import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSafeCandidate,
  parseSlackInviteHtml,
  renewalDueAt,
} from '../src/public-invite.mjs';

test('parses an active Seattle AI Safety invite', () => {
  const html = `
    <title>Join Seattle AI Safety</title>
    {&quot;isSharedInviteError&quot;:false,&quot;InviteExpirationTs&quot;:1790550000}
  `;
  const result = parseSlackInviteHtml(html);
  assert.equal(result.expiresAt.toISOString(), '2026-09-27T23:00:00.000Z');
});

test('rejects a different workspace', () => {
  assert.throws(
    () =>
      parseSlackInviteHtml(
        'Join Somewhere Else {&quot;isSharedInviteError&quot;:false,&quot;InviteExpirationTs&quot;:1790550000}',
      ),
    /WRONG_SLACK_WORKSPACE/,
  );
});

test('rejects an inactive invite', () => {
  assert.throws(
    () =>
      parseSlackInviteHtml(
        'Join Seattle AI Safety {&quot;isSharedInviteError&quot;:true,&quot;InviteExpirationTs&quot;:1790550000}',
      ),
    /SLACK_INVITE_INACTIVE/,
  );
});

test('candidate must extend expiry and last between 20 and 31 days', () => {
  const now = new Date('2026-08-29T12:00:00Z');
  const current = { expiresAt: new Date('2026-09-01T12:00:00Z') };
  const candidate = {
    url: 'https://join.slack.com/t/seattleaisafety/shared_invite/zt-123456789-Abcdefghijklmnopqrstuv',
    expiresAt: new Date('2026-09-28T12:00:00Z'),
  };
  assert.doesNotThrow(() => assertSafeCandidate(candidate, current, now));
});

test('accepts a legacy Slack invite token with a tilde', () => {
  const now = new Date('2026-08-29T12:00:00Z');
  const current = { expiresAt: new Date('2026-09-01T12:00:00Z') };
  const candidate = {
    url: 'https://join.slack.com/t/seattleaisafety/shared_invite/zt-3rhoypy01-~KujjmpkESfRykseyMZyCg2',
    expiresAt: new Date('2026-09-28T12:00:00Z'),
  };
  assert.doesNotThrow(() => assertSafeCandidate(candidate, current, now));
});

test('renewal is due one minute after expiry', () => {
  assert.equal(
    renewalDueAt(new Date('2026-09-28T23:14:56Z')).toISOString(),
    '2026-09-28T23:15:56.000Z',
  );
});
