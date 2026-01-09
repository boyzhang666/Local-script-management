import fs from 'fs';
import process from 'node:process';
import { commandConfigPath } from '../lib/paths.js';

export function isWindows() {
  return process.platform === 'win32';
}

export function isMac() {
  return process.platform === 'darwin';
}

export function isLinux() {
  return process.platform === 'linux';
}

export function getDefaultCommandConfig() {
  return {
    windows: {
      categories: [
        { value: 'exe', label: 'EXE 程序' },
        { value: 'bat', label: 'BAT 批处理' },
        { value: 'powershell', label: 'PowerShell 脚本' },
        { value: 'other', label: '其他' },
      ],
      commandTemplates: {
        exe: { pattern: '{cmd}', description: '直接执行 EXE 程序' },
        bat: { pattern: 'cmd /c {cmd}', description: '使用 cmd /c 执行批处理' },
        powershell: { pattern: 'powershell -ExecutionPolicy Bypass -File {cmd}', description: '使用 PowerShell 执行脚本' },
        other: { pattern: '{cmd}', description: '直接执行命令' },
      },
    },
    macos: {
      categories: [
        { value: 'shell', label: 'Shell 脚本' },
        { value: 'executable', label: '可执行程序' },
        { value: 'app', label: '应用程序' },
        { value: 'python', label: 'Python 脚本' },
        { value: 'other', label: '其他' },
      ],
      commandTemplates: {
        shell: { pattern: 'bash {cmd}', description: '使用 bash 执行 Shell 脚本' },
        executable: { pattern: 'chmod +x {cmd} 2>/dev/null; {cmd}', description: '添加执行权限后运行' },
        app: { pattern: 'open -a "{cmd}"', description: '使用 open -a 打开应用程序' },
        python: { pattern: 'python3 {cmd} 2>/dev/null || python {cmd}', description: '优先使用 python3 执行' },
        other: { pattern: '{cmd}', description: '直接执行命令' },
      },
    },
    linux: {
      categories: [
        { value: 'shell', label: 'Shell 脚本' },
        { value: 'executable', label: '可执行程序' },
        { value: 'python', label: 'Python 脚本' },
        { value: 'other', label: '其他' },
      ],
      commandTemplates: {
        shell: { pattern: 'bash {cmd}', description: '使用 bash 执行 Shell 脚本' },
        executable: { pattern: 'chmod +x {cmd} 2>/dev/null; {cmd}', description: '添加执行权限后运行' },
        python: { pattern: 'python3 {cmd} 2>/dev/null || python {cmd}', description: '优先使用 python3 执行' },
        other: { pattern: '{cmd}', description: '直接执行命令' },
      },
    },
  };
}

export function readCommandConfig() {
  try {
    const raw = fs.readFileSync(commandConfigPath(), 'utf8');
    const config = JSON.parse(raw);
    const defaults = getDefaultCommandConfig();
    return {
      windows: { ...defaults.windows, ...config.windows },
      macos: { ...defaults.macos, ...config.macos },
      linux: { ...defaults.linux, ...config.linux },
    };
  } catch {
    return getDefaultCommandConfig();
  }
}

export function writeCommandConfig(config) {
  try {
    fs.writeFileSync(commandConfigPath(), JSON.stringify(config, null, 2));
  } catch {
    /* ignore */
  }
}

export function getCurrentPlatform() {
  if (isWindows()) return 'windows';
  if (isMac()) return 'macos';
  if (isLinux()) return 'linux';
  return 'linux';
}

export function processCommandByCategory(command, category) {
  const raw = String(command || '').trim();
  if (!raw || !category) return raw;

  const config = readCommandConfig();
  const platform = getCurrentPlatform();
  const platformConfig = config[platform];
  if (!platformConfig || !platformConfig.commandTemplates) return raw;

  const template = platformConfig.commandTemplates[category];
  if (!template || !template.pattern) return raw;

  const pattern = String(template.pattern || '').trim();
  if (!pattern || pattern === '{cmd}') return raw;

  if (!pattern.includes('{cmd}')) return pattern;

  const startsWithInterpreter = /^(bash|sh|zsh|python|python3|node|powershell|pwsh|cmd|open)\b/i.test(raw);
  if (startsWithInterpreter) return raw;

  const hasShellOps = /&&|\|\||[;&|<>`]/.test(raw);
  if (hasShellOps) return raw;

  return pattern.replace(/\{cmd\}/g, raw);
}

export function isFireAndForgetCategory(category) {
  return category === 'app';
}
