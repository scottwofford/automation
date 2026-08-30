import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import {
  profileDirectory,
  slackAdminUrl,
  workspaceSlug,
} from './config.mjs';
import { preparePrivateDirectory } from './runtime.mjs';

async function launchProfile() {
  await preparePrivateDirectory();
  await fs.mkdir(profileDirectory, { recursive: true, mode: 0o700 });
  await fs.chmod(profileDirectory, 0o700);

  return chromium.launchPersistentContext(profileDirectory, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--no-first-run',
    ],
  });
}

async function openAdminPage(context) {
  const pages = context.pages();
  const page = pages[0] ?? (await context.newPage());
  await page.goto(slackAdminUrl, { waitUntil: 'domcontentloaded' });
  return page;
}

export async function login() {
  const context = await launchProfile();
  await openAdminPage(context);
  process.stdout.write(
    'LOGIN_BROWSER_OPEN: sign in to Seattle AI Safety, then close Chromium.\n',
  );
  await new Promise((resolve) => context.on('close', resolve));
}

function allowedSlackLocation(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') return false;
  return (
    parsed.hostname === `${workspaceSlug}.slack.com` ||
    parsed.hostname === 'app.slack.com' ||
    parsed.hostname === 'slack.com'
  );
}

export async function observeInviteControls() {
  const context = await launchProfile();
  const page = await openAdminPage(context);
  await page.waitForTimeout(4_000);

  if (!allowedSlackLocation(page.url())) {
    await context.close();
    throw new Error('UNEXPECTED_SLACK_REDIRECT');
  }

  const controls = await page
    .locator('button, a, [role="tab"]')
    .evaluateAll((elements) =>
      elements
        .map((element) => ({
          role: element.getAttribute('role') || element.tagName.toLowerCase(),
          text: (element.getAttribute('aria-label') || element.textContent || '')
            .replace(/\s+/g, ' ')
            .trim(),
        }))
        .filter(
          ({ text }) =>
            text.length <= 100 &&
            /(invite|invitation|link|renew|expire|copy|people)/i.test(text),
        )
        .slice(0, 50),
    );

  process.stdout.write(`${JSON.stringify({ url: page.url(), controls }, null, 2)}\n`);
  await context.close();
}

export async function createOrExtendInvite() {
  // Deliberately fail closed until the authenticated Slack interface has been
  // observed and the safe pre-expiry operation is proven. The implementation
  // must never deactivate the current public link.
  throw new Error('SLACK_UI_NOT_CALIBRATED');
}
