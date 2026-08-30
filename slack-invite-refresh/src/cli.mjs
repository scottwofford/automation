#!/usr/bin/env node
import { check, refresh } from './refresh.mjs';
import { configureGitHubToken } from './github-update.mjs';
import { installLaunchAgent, schedulerLoop } from './scheduler.mjs';
import { login, observeInviteControls } from './slack-browser.mjs';

const command = process.argv[2];

try {
  switch (command) {
    case 'login':
      await login();
      break;
    case 'observe':
      await observeInviteControls();
      break;
    case 'check': {
      const invite = await check();
      process.stdout.write(
        `PRODUCTION_INVITE_OK expires=${invite.expiresAt.toISOString()}\n`,
      );
      break;
    }
    case 'run':
      await refresh();
      break;
    case 'schedule':
      await schedulerLoop(refresh);
      break;
    case 'install-agent':
      await installLaunchAgent();
      process.stdout.write('LAUNCH_AGENT_INSTALLED\n');
      break;
    case 'configure-github':
      await configureGitHubToken();
      process.stdout.write('GITHUB_TOKEN_STORED\n');
      break;
    default:
      throw new Error(
        'Usage: node src/cli.mjs <login|observe|check|run|schedule|install-agent|configure-github>',
      );
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
