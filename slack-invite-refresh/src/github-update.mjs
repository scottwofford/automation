import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  githubConfigPath,
  githubOwner,
  githubRepository,
  publicConfigUrl,
} from './config.mjs';
import { assertInviteUrl, inspectInvite } from './public-invite.mjs';

const apiBase = 'https://api.github.com';
const waitMilliseconds = 15_000;
const maximumWaitMilliseconds = 10 * 60 * 1_000;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.capture ? ['ignore', 'pipe', 'ignore'] : 'inherit',
    });
    let stdout = '';
    if (options.capture) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
    }
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(options.errorCode || `COMMAND_EXIT_${code}`));
    });
  });
}

export async function readGitHubToken() {
  const candidates = [
    path.join(os.homedir(), 'bin', 'gh'),
    '/opt/homebrew/bin/gh',
    '/usr/local/bin/gh',
  ];
  let ghPath;
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      ghPath = candidate;
      break;
    } catch {
      // Try the next standard installation path.
    }
  }
  if (!ghPath) throw new Error('GITHUB_CLI_MISSING');

  return run(
    ghPath,
    ['auth', 'token'],
    { capture: true, errorCode: 'GITHUB_TOKEN_MISSING' },
  );
}

async function githubRequest(token, path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      ...(options.headers || {}),
    },
  });

  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(`GITHUB_HTTP_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function repositoryPath(suffix) {
  return `/repos/${githubOwner}/${githubRepository}${suffix}`;
}

export function localDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function desiredConfig(candidate, now = new Date()) {
  assertInviteUrl(candidate.url);
  return {
    url: candidate.url,
    expiresAt: candidate.expiresAt.toISOString().replace('.000Z', 'Z'),
    updatedAt: localDate(now),
  };
}

function sameConfig(first, second) {
  return (
    first.url === second.url &&
    first.expiresAt === second.expiresAt &&
    first.updatedAt === second.updatedAt
  );
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForMerge(token, pullRequestNumber, commitSha) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < maximumWaitMilliseconds) {
    const checks = await githubRequest(
      token,
      repositoryPath(`/commits/${commitSha}/check-runs`),
    );
    const failedCheck = checks.check_runs.find(
      (check) =>
        check.status === 'completed' &&
        !['success', 'neutral', 'skipped'].includes(check.conclusion),
    );
    if (failedCheck) throw new Error('GITHUB_CHECK_FAILED');

    try {
      const result = await githubRequest(
        token,
        repositoryPath(`/pulls/${pullRequestNumber}/merge`),
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sha: commitSha, merge_method: 'squash' }),
        },
      );
      if (result.merged) return;
    } catch (error) {
      if (![405, 409].includes(error.status)) throw error;
    }
    await sleep(waitMilliseconds);
  }
  throw new Error('GITHUB_MERGE_TIMEOUT');
}

async function waitForProduction(expected) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < maximumWaitMilliseconds) {
    try {
      const response = await fetch(publicConfigUrl, {
        cache: 'no-store',
        headers: { 'cache-control': 'no-cache' },
      });
      if (response.ok && sameConfig(await response.json(), expected)) {
        await inspectInvite(expected.url);
        return;
      }
    } catch {
      // Deployment and public validation are retried until the bounded timeout.
    }
    await sleep(waitMilliseconds);
  }
  throw new Error('PRODUCTION_DEPLOY_TIMEOUT');
}

export async function publishCandidate(candidate) {
  const expected = desiredConfig(candidate);
  const token = await readGitHubToken();
  const currentFile = await githubRequest(
    token,
    repositoryPath(`/contents/${githubConfigPath}?ref=main`),
  );
  const currentConfig = JSON.parse(
    Buffer.from(currentFile.content, 'base64').toString('utf8'),
  );
  if (sameConfig(currentConfig, expected)) {
    await waitForProduction(expected);
    return;
  }

  const main = await githubRequest(
    token,
    repositoryPath('/git/ref/heads/main'),
  );
  const candidateId = createHash('sha256')
    .update(JSON.stringify(expected))
    .digest('hex')
    .slice(0, 12);
  const branch = `automation/slack-invite-${candidateId}`;
  try {
    await githubRequest(token, repositoryPath('/git/refs'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: main.object.sha,
      }),
    });
  } catch (error) {
    if (error.status !== 422) throw error;
  }

  const branchFile = await githubRequest(
    token,
    repositoryPath(`/contents/${githubConfigPath}?ref=${branch}`),
  );
  const branchConfig = JSON.parse(
    Buffer.from(branchFile.content, 'base64').toString('utf8'),
  );
  if (!sameConfig(branchConfig, expected)) {
    await githubRequest(token, repositoryPath(`/contents/${githubConfigPath}`), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: 'Refresh Seattle AI Safety Slack invite',
        content: Buffer.from(`${JSON.stringify(expected, null, 2)}\n`).toString(
          'base64',
        ),
        sha: branchFile.sha,
        branch,
      }),
    });
  }

  const comparison = await githubRequest(
    token,
    repositoryPath(`/compare/main...${branch}`),
  );
  if (
    comparison.files.length !== 1 ||
    comparison.files[0].filename !== githubConfigPath ||
    comparison.files[0].status !== 'modified'
  ) {
    throw new Error('GITHUB_DIFF_NOT_EXACTLY_ONE_CONFIG_FILE');
  }

  const existingPullRequests = await githubRequest(
    token,
    repositoryPath(
      `/pulls?state=open&head=${encodeURIComponent(`${githubOwner}:${branch}`)}`,
    ),
  );
  const pullRequest =
    existingPullRequests[0] ||
    (await githubRequest(token, repositoryPath('/pulls'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Refresh Seattle AI Safety Slack invite',
        head: branch,
        base: 'main',
        body: [
          'Automated renewal of the Seattle AI Safety Slack invitation.',
          '',
          '- Public Slack metadata confirms the invitation is active.',
          '- The expiry is 20 to 31 days away.',
          '- Only `site/slack/invite.json` changed.',
        ].join('\n'),
      }),
    }));

  await waitForMerge(token, pullRequest.number, pullRequest.head.sha);
  await waitForProduction(expected);
}
