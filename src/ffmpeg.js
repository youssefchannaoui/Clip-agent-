import { spawn } from 'node:child_process';

/**
 * Render's build servers have real internet access, so `ffmpeg-static`
 * (a portable prebuilt binary) installs fine there via npm install. Local
 * development machines may not have that package installed — in which
 * case fall back to a plain `ffmpeg` already on the PATH.
 */
export async function ffmpegPath() {
  try {
    const mod = await import('ffmpeg-static');
    if (mod?.default) return mod.default;
  } catch { /* not installed here — fall through */ }
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

function run(bin, args, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Timed out.')); }, timeoutMs);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`exited ${code}: ${(stderr || stdout).slice(-300)}`));
    });
  });
}

/**
 * Actually try to run ffmpeg and report what happened — this is the direct,
 * no-guessing answer to "is ffmpeg working on this server", the same
 * question that used to require reading Render's build logs to answer.
 */
export async function checkFfmpeg() {
  const bin = await ffmpegPath();
  let usingStatic = false;
  try { usingStatic = Boolean((await import('ffmpeg-static'))?.default); } catch {}

  try {
    const { stderr } = await run(bin, ['-version']);
    const firstLine = stderr.split('\n')[0] || 'ffmpeg';
    return { ok: true, bin, usingStatic, version: firstLine };
  } catch (err) {
    return {
      ok: false,
      bin,
      usingStatic,
      error: err.message,
      hint: usingStatic
        ? 'The ffmpeg-static package is installed but the binary itself failed to run.'
        : 'ffmpeg-static is not installed, and no system ffmpeg was found either. On Render, check that the Build Command is "npm install", not the original "echo ok".',
    };
  }
}
