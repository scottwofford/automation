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

  const inviteLinksTab = page.getByRole('tab', { name: 'Invite Links' });
  if ((await inviteLinksTab.count()) !== 1) {
    await context.close();
    throw new Error('INVITE_LINKS_TAB_NOT_UNIQUE');
  }
  await inviteLinksTab.click();
  await page.waitForTimeout(2_000);

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

  const rows = await page
    .locator('tr, [role="row"]')
    .evaluateAll((elements) =>
      elements
        .map((element, index) => ({
          index,
          text: (element.textContent || '')
            .replace(/https:\/\/join\.slack\.com\/\S+/gi, '[invite link]')
            .replace(/zt-[a-z0-9]{9}-~?[A-Za-z0-9_]{22}/g, '[invite token]')
            .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
            .replace(/\s+/g, ' ')
            .trim(),
        }))
        .filter(
          ({ text }) =>
            text.length <= 500 &&
            /(renew|deactivate|feb|expired|active|created)/i.test(text),
        )
        .slice(0, 50),
    );

  process.stdout.write(
    `${JSON.stringify({ url: page.url(), controls, rows }, null, 2)}\n`,
  );
  await context.close();
}

async function openInviteLinks(context) {
  const page = await openAdminPage(context);
  await page.waitForTimeout(4_000);
  if (!allowedSlackLocation(page.url())) {
    throw new Error('UNEXPECTED_SLACK_REDIRECT');
  }

  const tab = page.getByRole('tab', { name: 'Invite Links' });
  if ((await tab.count()) !== 1) {
    throw new Error('INVITE_LINKS_TAB_NOT_UNIQUE');
  }
  await tab.click();
  await page.waitForTimeout(2_000);
  return page;
}

export async function createOrExtendInvite(current) {
  const context = await launchProfile();
  try {
    const page = await openInviteLinks(context);
    const token = current.url.split('/').at(-1);
    const matchingRows = page
      .locator('tr, [role="row"]')
      .filter({ hasText: token })
      .filter({ has: page.getByRole('button', { name: 'Renew', exact: true }) });
    if ((await matchingRows.count()) !== 1) {
      throw new Error('CURRENT_INVITE_RENEW_TARGET_NOT_UNIQUE');
    }

    const row = matchingRows.first();
    const rowText = (await row.textContent()) || '';
    if (/Deactivate/i.test(rowText) || !/Expired on/i.test(rowText)) {
      throw new Error('CURRENT_INVITE_NOT_EXPIRED');
    }

    await row.getByRole('button', { name: 'Renew', exact: true }).click();
    await page.waitForTimeout(500);

    const dialog = page.getByRole('dialog');
    if ((await dialog.count()) === 1 && (await dialog.isVisible())) {
      const confirm = dialog.getByRole('button', {
        name: 'Renew',
        exact: true,
      });
      if ((await confirm.count()) !== 1) {
        throw new Error('RENEW_CONFIRMATION_AMBIGUOUS');
      }
      await confirm.click();
    }

    const renewedRow = page
      .locator('tr, [role="row"]')
      .filter({ hasText: token });
    await renewedRow.getByText('Deactivate', { exact: true }).waitFor({
      state: 'visible',
      timeout: 15_000,
    });
    return { url: current.url };
  } finally {
    await context.close();
  }
}
