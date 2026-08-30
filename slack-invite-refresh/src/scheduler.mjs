import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  launchAgentFile,
  launchAgentLabel,
  profileDirectory,
} from './config.mjs';
import { readProductionConfig, renewalDueAt } from './public-invite.mjs';
import { notify, preparePrivateDirectory, recordEvent, repositoryRoot } from './runtime.mjs';

const maximumSleepMilliseconds = 2_000_000_000;
const retryMilliseconds = 6 * 60 * 60 * 1_000;
const slowRetryMilliseconds = 24 * 60 * 60 * 1_000;

export function millisecondsUntilDue(expiresAt, now = new Date()) {
  return Math.max(0, renewalDueAt(expiresAt).getTime() - now.getTime());
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function schedulerLoop(runRefresh) {
  let consecutiveFailures = 0;
  for (;;) {
    try {
      const current = await readProductionConfig();
      let remaining = millisecondsUntilDue(current.expiresAt);

      while (remaining > 0) {
        await sleep(Math.min(remaining, maximumSleepMilliseconds));
        remaining = millisecondsUntilDue(current.expiresAt);
      }

      await runRefresh();
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      const code = (error.message || 'REFRESH_FAILED')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'REFRESH_FAILED';
      await recordEvent(code);
      await notify(
        'Slack invite refresh failed',
        `${code}. The current invite was not deactivated.`,
      );
      await sleep(
        consecutiveFailures <= 3 ? retryMilliseconds : slowRetryMilliseconds,
      );
    }
  }
}

function xmlEscape(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function launchAgentPlist({ nodePath, cliPath }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${launchAgentLabel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodePath)}</string>
    <string>${xmlEscape(cliPath)}</string>
    <string>schedule</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`COMMAND_EXIT_${code}`)),
    );
  });
}

export async function installLaunchAgent() {
  await preparePrivateDirectory();
  try {
    await fs.access(profileDirectory);
  } catch {
    throw new Error('LOGIN_PROFILE_MISSING');
  }
  const cliPath = `${repositoryRoot()}/src/cli.mjs`;
  await fs.mkdir(path.dirname(launchAgentFile), { recursive: true });
  await fs.writeFile(
    launchAgentFile,
    launchAgentPlist({ nodePath: process.execPath, cliPath }),
    { mode: 0o644 },
  );

  const domain = `gui/${process.getuid()}`;
  await run('/bin/launchctl', ['bootout', domain, launchAgentFile]).catch(
    () => {},
  );
  await run('/bin/launchctl', ['bootstrap', domain, launchAgentFile]);
  await run('/bin/launchctl', ['enable', `${domain}/${launchAgentLabel}`]);
}
