import express from 'express';
import { listProcessesByPort, searchProcesses, killProcessByPid } from '../services/processManager.js';

const router = express.Router();

router.get('/search', async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name) return res.json([]);
  const result = await searchProcesses(name);
  res.status(result.status ?? (result.ok ? 200 : 500)).json(result.body);
});

router.get('/by-port/:port', async (req, res) => {
  const portNum = parseInt(String(req.params.port || '').trim(), 10);
  const result = await listProcessesByPort(portNum);
  res.status(result.status ?? (result.ok ? 200 : 500)).json(result.body);
});

router.post('/kill', async (req, res) => {
  const { pid, signal } = req.body || {};
  const result = await killProcessByPid(pid, signal);
  res.status(result.status ?? (result.ok ? 200 : 500)).json(result.body);
});

export default router;
