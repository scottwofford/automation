import assert from 'node:assert/strict';
import test from 'node:test';
import { desiredConfig, localDate } from '../src/github-update.mjs';

test('formats the site configuration exactly', () => {
  const candidate = {
    url: 'https://join.slack.com/t/seattleaisafety/shared_invite/zt-123456789-Abcdefghijklmnopqrstuv',
    expiresAt: new Date('2026-09-28T23:14:56Z'),
  };
  assert.deepEqual(
    desiredConfig(candidate, new Date('2026-08-30T02:00:00Z')),
    {
      url: candidate.url,
      expiresAt: '2026-09-28T23:14:56Z',
      updatedAt: '2026-08-29',
    },
  );
});

test('uses the Seattle calendar date', () => {
  assert.equal(localDate(new Date('2026-08-29T06:00:00Z')), '2026-08-28');
});
