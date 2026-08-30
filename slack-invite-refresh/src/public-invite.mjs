import {
  invitePrefix,
  maximumCandidateDays,
  minimumCandidateDays,
  publicConfigUrl,
  renewAfterMilliseconds,
  workspaceName,
} from './config.mjs';

const millisecondsPerDay = 86_400_000;

export function assertInviteUrl(url) {
  if (typeof url !== 'string' || !url.startsWith(invitePrefix)) {
    throw new Error('INVALID_WORKSPACE_INVITE_URL');
  }

  const suffix = url.slice(invitePrefix.length);
  if (!/^zt-[a-z0-9]{9}-~?[A-Za-z0-9_]{22}$/.test(suffix)) {
    throw new Error('INVALID_SLACK_INVITE_TOKEN');
  }
}

export function parseSlackInviteHtml(html) {
  if (!html.includes(`Join ${workspaceName}`)) {
    throw new Error('WRONG_SLACK_WORKSPACE');
  }

  if (!/isSharedInviteError(?:&quot;|")\s*:\s*false/.test(html)) {
    throw new Error('SLACK_INVITE_INACTIVE');
  }

  const match = html.match(
    /InviteExpirationTs(?:&quot;|")\s*:\s*(?:&quot;|")?(\d+)/,
  );
  if (!match) {
    throw new Error('SLACK_EXPIRY_NOT_FOUND');
  }

  const expiresAt = new Date(Number(match[1]) * 1_000);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error('SLACK_EXPIRY_INVALID');
  }

  return { expiresAt };
}

export async function inspectInvite(url, fetchImplementation = fetch) {
  assertInviteUrl(url);
  const response = await fetchImplementation(url, {
    redirect: 'follow',
    headers: {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138 Safari/537.36',
    },
  });
  if (!response.ok) {
    throw new Error(`SLACK_HTTP_${response.status}`);
  }

  const { expiresAt } = parseSlackInviteHtml(await response.text());
  return { url, expiresAt };
}

export async function readProductionConfig(fetchImplementation = fetch) {
  const response = await fetchImplementation(publicConfigUrl, {
    cache: 'no-store',
    headers: { 'cache-control': 'no-cache' },
  });
  if (!response.ok) {
    throw new Error(`PRODUCTION_CONFIG_HTTP_${response.status}`);
  }

  const config = await response.json();
  assertInviteUrl(config.url);
  const expiresAt = new Date(config.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error('PRODUCTION_EXPIRY_INVALID');
  }

  return { ...config, expiresAt };
}

export async function validateProductionInvite(fetchImplementation = fetch) {
  const config = await readProductionConfig(fetchImplementation);
  const live = await inspectInvite(config.url, fetchImplementation);
  if (live.expiresAt.getTime() !== config.expiresAt.getTime()) {
    throw new Error('PRODUCTION_EXPIRY_MISMATCH');
  }

  return live;
}

export function assertSafeCandidate(candidate, current, now = new Date()) {
  assertInviteUrl(candidate.url);
  const daysRemaining =
    (candidate.expiresAt.getTime() - now.getTime()) / millisecondsPerDay;
  if (
    daysRemaining < minimumCandidateDays ||
    daysRemaining > maximumCandidateDays
  ) {
    throw new Error('CANDIDATE_EXPIRY_OUT_OF_RANGE');
  }

  if (candidate.expiresAt.getTime() <= current.expiresAt.getTime()) {
    throw new Error('CANDIDATE_DOES_NOT_EXTEND_EXPIRY');
  }
}

export function renewalDueAt(expiresAt) {
  return new Date(expiresAt.getTime() + renewAfterMilliseconds);
}
