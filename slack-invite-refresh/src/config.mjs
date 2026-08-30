import os from 'node:os';
import path from 'node:path';

export const workspaceSlug = 'seattleaisafety';
export const workspaceName = 'Seattle AI Safety';
export const invitePrefix = `https://join.slack.com/t/${workspaceSlug}/shared_invite/`;
export const publicConfigUrl = 'https://luthien.cc/slack/invite.json';
export const slackAdminUrl = `https://${workspaceSlug}.slack.com/admin/invites`;
export const renewBeforeDays = 3;
export const minimumCandidateDays = 20;
export const maximumCandidateDays = 31;

export const dataDirectory = path.join(
  os.homedir(),
  '.local',
  'share',
  'seattle-slack-invite-refresh',
);
export const profileDirectory = path.join(dataDirectory, 'playwright-profile');
export const stateFile = path.join(dataDirectory, 'state.json');
export const lockDirectory = path.join(dataDirectory, 'run.lock');
export const logFile = path.join(dataDirectory, 'events.log');
export const calibrationFile = path.join(dataDirectory, 'slack-ui-calibrated');

export const githubOwner = 'LuthienResearch';
export const githubRepository = 'luthien-pbc-site';
export const githubConfigPath = 'site/slack/invite.json';
export const githubKeychainService = 'seattle-slack-invite-refresh-github';
export const githubKeychainAccount = 'github-token';

export const launchAgentLabel = 'com.scott.seattle-slack-invite-refresh';
export const launchAgentFile = path.join(
  os.homedir(),
  'Library',
  'LaunchAgents',
  `${launchAgentLabel}.plist`,
);
