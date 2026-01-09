export function genId() {
  return 'proj_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export function dedupeProjects(items) {
  const map = new Map();
  for (const p of items) {
    if (!p || typeof p !== 'object') continue;
    const id = String(p.id || '').trim();
    if (!id) continue;
    const prev = map.get(id);
    if (!prev) { map.set(id, p); continue; }
    const pTime = Date.parse(p.updated_date || '') || 0;
    const prevTime = Date.parse(prev.updated_date || '') || 0;
    if (pTime > prevTime) map.set(id, p);
  }
  return Array.from(map.values());
}

export function ringBuffer(limit = 200) {
  const arr = [];
  return {
    push(line) {
      arr.push(line);
      if (arr.length > limit) arr.shift();
    },
    get() {
      return arr.slice();
    },
    clear() {
      arr.length = 0;
    }
  };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRunning(child) {
  return !!child && child.exitCode === null && child.signalCode === null;
}
