import assert from 'node:assert/strict';
import test from 'node:test';
import { launchAgentPlist, millisecondsUntilDue } from '../src/scheduler.mjs';

test('scheduler waits until one minute after expiry', () => {
  const now = new Date('2026-09-28T23:14:56Z');
  const expiry = new Date('2026-09-28T23:14:56Z');
  assert.equal(millisecondsUntilDue(expiry, now), 60_000);
});

test('launch agent stays alive without a daily interval', () => {
  const plist = launchAgentPlist({
    nodePath: '/opt/homebrew/bin/node',
    cliPath: '/Users/example/automation/slack-invite-refresh/src/cli.mjs',
  });
  assert.match(plist, /<key>KeepAlive<\/key>/);
  assert.doesNotMatch(plist, /StartInterval|StartCalendarInterval/);
});
