import { spawn } from 'child_process';

export async function collectOutput(command, args, options = {}) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { shell: false, ...options });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => { resolve({ stdout: '', stderr: String(err), code: 1 }); });
    child.on('close', (code) => { resolve({ stdout, stderr, code }); });
  });
}
