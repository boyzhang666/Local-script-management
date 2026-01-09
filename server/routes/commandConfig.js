import express from 'express';
import { readCommandConfig, writeCommandConfig, getDefaultCommandConfig, getCurrentPlatform } from '../services/commandConfig.js';

const router = express.Router();

router.get('/', (req, res) => {
  const config = readCommandConfig();
  const platform = getCurrentPlatform();
  res.json({ config, currentPlatform: platform });
});

router.put('/', (req, res) => {
  const data = req.body || {};
  if (!data.config) {
    return res.status(400).json({ error: 'config is required' });
  }
  writeCommandConfig(data.config);
  res.json({ ok: true });
});

router.post('/reset', (req, res) => {
  const defaults = getDefaultCommandConfig();
  writeCommandConfig(defaults);
  res.json({ ok: true, config: defaults });
});

export default router;
