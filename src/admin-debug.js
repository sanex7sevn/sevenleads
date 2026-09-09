import path from 'node:path';
import fs from 'node:fs';
import { getDebugEvents } from './debug-state.js';

export function ownerOnly(adminEmail) {
  return (req, res, next) => {
    if (req.user?.role !== 'admin' || !adminEmail || req.user.email?.toLowerCase() !== adminEmail.toLowerCase()) {
      return res.status(403).json({ error: 'Diagnóstico restrito ao administrador principal.' });
    }
    next();
  };
}
function containerMemory(filename) {
  try {
    const value = Number(fs.readFileSync(`/sys/fs/cgroup/${filename}`, 'utf8').trim());
    return Number.isFinite(value) && value > 0 && value < Number.MAX_SAFE_INTEGER ? value : null;
  } catch { return null; }
}
export function registerAdminDebug(app, { authenticateToken, requireAdmin, adminEmail, listDebugSearches, root }) {
  const noCache = (_req, res, next) => { res.set('Cache-Control', 'no-store, private'); next(); };
  const guards = [noCache, authenticateToken, requireAdmin, ownerOnly(adminEmail)];
  app.get('/api/admin/debug', ...guards, (req, res) => {
    const email = String(req.query.email || '').trim().toLowerCase();
    if (email.length > 254) return res.status(400).json({ error: 'E-mail muito longo.' });
    res.json({
      at: new Date().toISOString(),
      runtime: { node: process.version, uptimeSeconds: Math.floor(process.uptime()), processMemoryBytes: process.memoryUsage().rss,
        containerMemoryBytes: containerMemory('memory.current') ?? containerMemory('memory/memory.usage_in_bytes'),
        containerLimitBytes: containerMemory('memory.max') ?? containerMemory('memory/memory.limit_in_bytes') },
      jobs: listDebugSearches(email), events: getDebugEvents(email)
    });
  });
  for (const [url, filename] of [['/admin/debug', 'debug.html'], ['/admin/debug/app.js', 'debug.js'], ['/admin/debug/style.css', 'debug.css']]) {
    app.get(url, ...guards, (_req, res) => res.sendFile(path.join(root, 'admin', filename)));
  }
}
