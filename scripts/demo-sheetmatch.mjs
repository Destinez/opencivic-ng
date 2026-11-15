import { spawnSync } from 'node:child_process';
let compose = false;
if (!process.env.DATABASE_URL && !process.env.UPLOAD_DIR) {
  const services = spawnSync('docker', ['compose', 'ps', '--status', 'running', '--services'], {
    encoding: 'utf8',
  });
  compose = services.status === 0 && services.stdout.split('\n').includes('api');
}
const command = compose ? 'docker' : 'pnpm';
const args = compose
  ? ['compose', 'exec', '-T', 'api', 'pnpm', 'exec', 'tsx', 'src/demo-cli.ts']
  : ['--filter', '@opencivic/api', 'exec', 'tsx', 'src/demo-cli.ts'];
const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
