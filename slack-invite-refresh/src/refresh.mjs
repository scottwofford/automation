import { createOrExtendInvite } from './slack-browser.mjs';
import { publishCandidate } from './github-update.mjs';
import {
  assertSafeCandidate,
  inspectInvite,
  readProductionConfig,
  renewalDueAt,
  validateProductionInvite,
} from './public-invite.mjs';
import {
  acquireLock,
  readState,
  recordEvent,
  writeState,
} from './runtime.mjs';

export async function refresh() {
  const release = await acquireLock();
  try {
    const current = await readProductionConfig();
    const state = await readState();
    let candidate;

    if (state.pendingCandidate) {
      candidate = await inspectInvite(state.pendingCandidate.url);
      if (
        candidate.url === current.url &&
        candidate.expiresAt.getTime() === current.expiresAt.getTime()
      ) {
        await writeState({});
        await recordEvent('REFRESH_COMPLETE');
        return candidate;
      }
    } else {
      try {
        const live = await inspectInvite(current.url);
        if (live.expiresAt.getTime() > current.expiresAt.getTime()) {
          candidate = live;
        } else if (new Date() < renewalDueAt(current.expiresAt)) {
          throw new Error('RENEWAL_NOT_DUE');
        } else {
          throw new Error('CURRENT_INVITE_STILL_ACTIVE');
        }
      } catch (error) {
        if (
          !['WRONG_SLACK_WORKSPACE', 'SLACK_INVITE_INACTIVE'].includes(
            error.message,
          )
        ) {
          throw error;
        }
        const browserResult = await createOrExtendInvite(current);
        candidate = await inspectInvite(browserResult.url);
      }
      assertSafeCandidate(candidate, current);

      await writeState({
        pendingCandidate: {
          url: candidate.url,
          expiresAt: candidate.expiresAt.toISOString(),
        },
      });
    }

    assertSafeCandidate(candidate, current);
    await publishCandidate(candidate);
    await writeState({});
    await recordEvent('REFRESH_COMPLETE');
    return candidate;
  } finally {
    await release();
  }
}

export async function check() {
  const invite = await validateProductionInvite();
  await recordEvent('PRODUCTION_INVITE_OK');
  return invite;
}
