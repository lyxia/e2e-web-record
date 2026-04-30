import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const repoRoot = path.resolve(__dirname, '..');

function runResumeCli(stateDir: string): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync(
      process.execPath,
      ['-r', 'ts-node/register', path.join(repoRoot, 'src', 'resume.ts'), '--state-dir', stateDir],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { stdout, stderr: '', status: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString?.() ?? '',
      stderr: err.stderr?.toString?.() ?? '',
      status: typeof err.status === 'number' ? err.status : 1,
    };
  }
}

describe('resume CLI', () => {
  it('creates progress.json and reports run-scan as next action', () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-cli-'));
    const result = runResumeCli(stateDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Next action: run-scan');
    const progressPath = path.join(stateDir, 'progress.json');
    expect(fs.existsSync(progressPath)).toBe(true);
    const progress = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
    expect(progress.currentPhase).toBe('scan');
  });
});
