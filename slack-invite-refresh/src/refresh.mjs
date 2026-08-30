import { createOrExtendInvite } from './slack-browser.mjs';
import { publishCandidate } from './github-update.mjs';
import {
  assertSafeCandidate,
  inspectInvite,
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
    const current = await validateProductionInvite();
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
      const browserResult = await createOrExtendInvite(current);
      candidate = await inspectInvite(browserResult.url);
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
