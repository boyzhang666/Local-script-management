import fs from 'fs';
import path from 'path';
import { baseRunDir } from './env.js';

export function ensureTaskDir() {
  const base = baseRunDir();
  const dir = path.join(base, 'task');
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch {
    /* ignore */
  }
  return dir;
}

export function taskFilePath() {
  const dir = ensureTaskDir();
  return path.join(dir, 'tasks.json');
}

export function commandConfigPath() {
  const dir = ensureTaskDir();
  return path.join(dir, 'command-config.json');
}
