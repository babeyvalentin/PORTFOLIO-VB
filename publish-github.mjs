import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const repository = 'https://github.com/babeyvalentin/PORTFOLIO-VB.git';
const branch = 'main';

function run(command, args, options = {}) {
  const logs = options.logs || [];
  const stdio = options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'];

  return new Promise((resolve, reject) => {
    logs.push(`$ ${[command, ...args].join(' ')}`);
    const child = spawn(command, args, {
      cwd: options.cwd || root,
      stdio,
      env: { ...process.env, GIT_TERMINAL_PROMPT: options.inherit ? '1' : '0' },
    });

    if (!options.inherit) {
      child.stdout.on('data', data => logs.push(String(data).trim()));
      child.stderr.on('data', data => logs.push(String(data).trim()));
    }

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} a échoué avec le code ${code}`));
    });
  });
}

export async function publishPortfolio({ inherit = false } = {}) {
  const logs = [];
  const temp = await mkdtemp(path.join(os.tmpdir(), 'portfolio-publish-'));
  const repoDir = path.join(temp, 'repo');

  try {
    await run('/usr/bin/git', ['clone', '--depth', '1', '--branch', branch, repository, repoDir], { logs, inherit });
    await cp(path.join(root, 'index.html'), path.join(repoDir, 'index.html'));
    await rm(path.join(repoDir, 'images'), { recursive: true, force: true });
    await cp(path.join(root, 'images'), path.join(repoDir, 'images'), { recursive: true });

    await run('/usr/bin/git', ['add', 'index.html', 'images'], { cwd: repoDir, logs, inherit });

    const statusLogs = [];
    await run('/usr/bin/git', ['status', '--porcelain'], { cwd: repoDir, logs: statusLogs, inherit: false });
    const status = statusLogs.slice(1).join('\n').trim();
    if (!status) {
      logs.push('Aucun changement à publier.');
      return { changed: false, logs };
    }

    await run('/usr/bin/git', ['commit', '-m', 'Update portfolio content'], { cwd: repoDir, logs, inherit });
    await run('/usr/bin/git', ['push', 'origin', branch], { cwd: repoDir, logs, inherit });
    logs.push('Publication GitHub terminée.');
    return { changed: true, logs };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  publishPortfolio({ inherit: true }).catch(error => {
    console.error('');
    console.error(error.message);
    console.error('');
    console.error('Si GitHub demande une connexion, connecte-toi avec tes identifiants GitHub puis relance cette commande.');
    process.exit(1);
  });
}
