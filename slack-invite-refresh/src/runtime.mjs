import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDirectory, lockDirectory, logFile, stateFile } from './config.mjs';

export async function preparePrivateDirectory() {
  await fs.mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  await fs.chmod(dataDirectory, 0o700);
}

export async function acquireLock() {
  await preparePrivateDirectory();
  try {
    await fs.mkdir(lockDirectory, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error('REFRESH_ALREADY_RUNNING');
    }
    throw error;
  }

  return async () => {
    await fs.rm(lockDirectory, { recursive: true, force: true });
  };
}

export async function readState() {
  try {
    return JSON.parse(await fs.readFile(stateFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

export async function writeState(state) {
  await preparePrivateDirectory();
  const temporaryFile = `${stateFile}.${process.pid}.tmp`;
  await fs.writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  await fs.rename(temporaryFile, stateFile);
  await fs.chmod(stateFile, 0o600);
}

export async function recordEvent(code) {
  await preparePrivateDirectory();
  if (!/^[A-Z0-9_]+$/.test(code)) {
    throw new Error('INVALID_EVENT_CODE');
  }
  await fs.appendFile(logFile, `${new Date().toISOString()},${code}\n`, {
    mode: 0o600,
  });
  await fs.chmod(logFile, 0o600);
}

export async function notify(title, message) {
  const { spawn } = await import('node:child_process');
  const escapeAppleScript = (value) =>
    value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  const script = `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}"`;
  const child = spawn('/usr/bin/osascript', ['-e', script], {
    stdio: 'ignore',
  });
  child.unref();
}

export function repositoryRoot() {
  return path.resolve(import.meta.dirname, '..');
}
