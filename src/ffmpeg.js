import { spawn } from 'node:child_process';
import { config } from './config.js';

function run(bin, args, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Timed out.'));
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error((stderr || stdout).slice(-500)));
    });
  });
}

export async function ffmpegPath() {
  return config.ffmpegPath;
}

export async function checkFfmpeg() {
  try {
    const ffmpeg = await run(config.ffmpegPath, ['-version']);
    const ffprobe = await run(config.ffprobePath, ['-version']);
    return {
      ok: true,
      bin: config.ffmpegPath,
      probeBin: config.ffprobePath,
      usingStatic: false,
      version: (ffmpeg.stdout || ffmpeg.stderr).split('\n')[0],
      probeVersion: (ffprobe.stdout || ffprobe.stderr).split('\n')[0],
    };
  } catch (error) {
    return {
      ok: false,
      bin: config.ffmpegPath,
      probeBin: config.ffprobePath,
      usingStatic: false,
      error: error.message,
      hint: 'Install FFmpeg and make sure ffmpeg/ffprobe are on PATH, or set FFMPEG_PATH and FFPROBE_PATH.',
    };
  }
}
