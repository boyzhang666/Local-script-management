import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import process from 'node:process';
import { fileURLToPath } from 'url';
import projectsRouter from './routes/projects.js';
import processesRouter from './routes/processes.js';
import commandConfigRouter from './routes/commandConfig.js';
import { resetPersistedRuntimeStateOnBoot } from './services/storage.js';
import { setupGuardian, shutdown } from './services/processManager.js';

const app = express();
app.use(express.json());
app.use(cors());

app.use('/api/projects', projectsRouter);
app.use('/api/processes', processesRouter);
app.use('/api/command-config', commandConfigRouter);

const PREFERRED_PORT = (() => {
  const v = parseInt(String(process.env.PORT || '3001'), 10);
  return Number.isFinite(v) && v > 0 ? v : 3001;
})();

function resolveStaticDir() {
  const execDir = path.dirname(process.execPath);
  const fromExec = path.join(execDir, 'dist');
  if (fs.existsSync(fromExec)) return fromExec;
  const fromSnapshot = (() => {
    try {
      const dir = path.dirname(fileURLToPath(import.meta.url));
      return path.join(dir, '../dist');
    } catch {
      return null;
    }
  })();
  if (fromSnapshot && fs.existsSync(fromSnapshot)) return fromSnapshot;
  const fromCwd = path.join(process.cwd(), 'dist');
  if (fs.existsSync(fromCwd)) return fromCwd;
  return null;
}

const staticDir = resolveStaticDir();
if (staticDir) {
  app.use(express.static(staticDir));
  app.get('*', (req, res) => {
    res.sendFile(path.join(staticDir, 'index.html'));
  });
}

function listAddresses() {
  const ifs = os.networkInterfaces();
  const addrs = ['127.0.0.1'];
  for (const name of Object.keys(ifs)) {
    for (const info of ifs[name] || []) {
      if (info.family === 'IPv4' && !info.internal) addrs.push(info.address);
    }
  }
  return Array.from(new Set(addrs));
}

function startServerWithFallback() {
  let port = PREFERRED_PORT;
  const max = PREFERRED_PORT + 9;
  const tryListen = () => {
    const server = app.listen(port, () => {
      const addrs = listAddresses();
      console.log(`Local process server running (PID ${process.pid})`);
      for (const a of addrs) {
        console.log(`- Backend:  http://${a}:${port}/api`);
        console.log(`- Frontend: http://${a}:${port}/`);
      }
    });
    server.on('error', (err) => {
      if (err && err.code === 'EADDRINUSE' && port < max) { port += 1; tryListen(); }
      else { console.error(String(err)); process.exit(1); }
    });
  };
  tryListen();
}

resetPersistedRuntimeStateOnBoot();
setupGuardian();
startServerWithFallback();

['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => {
    shutdown(sig);
  });
});
