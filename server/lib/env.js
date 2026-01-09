import fs from 'fs';
import path from 'path';
import process from 'node:process';

export function baseRunDir() {
  try {
    return typeof process.pkg !== 'undefined'
      ? path.dirname(process.execPath)
      : process.cwd();
  } catch {
    return process.cwd();
  }
}

export function safeCwd(working_directory) {
  const base = baseRunDir();
  if (!working_directory || !String(working_directory).trim()) return base;
  const candidate = path.isAbsolute(working_directory) ? working_directory : path.join(base, working_directory);
  try {
    const st = fs.statSync(candidate);
    if (st && st.isDirectory()) return candidate;
  } catch {
    /* ignore */
  }
  return base;
}

export function buildTaskEnv(projectEnv) {
  const merged = {
    ...process.env,
    ...((projectEnv && typeof projectEnv === 'object')
      ? projectEnv
      : {}),
  };
  if (process.env.PORT && (!projectEnv || !Object.prototype.hasOwnProperty.call(projectEnv, 'PORT'))) {
    delete merged.PORT;
  }
  return merged;
}
