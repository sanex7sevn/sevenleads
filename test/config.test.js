import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

test('servidor recusa iniciar sem credenciais obrigatórias', () => {
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sevenleads-config-'));
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    SEVENLEADS_DIR: emptyRoot
  };
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', "import('./src/config.js')"], {
    cwd: path.join(import.meta.dirname, '..'), env, encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Configuração obrigatória ausente: JWT_SECRET/);
  fs.rmSync(emptyRoot, { recursive: true, force: true });
});

