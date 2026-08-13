#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${TMPDIR:-/tmp}/deenclipped-smoke"
rm -rf "$WORK"
mkdir -p "$WORK"/{job,source,out}

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i 'testsrc2=size=1280x720:rate=30:duration=18' \
  -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=18' \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -shortest "$WORK/input.mp4"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i 'sine=frequency=220:sample_rate=48000:duration=4' \
  -c:a libmp3lame "$WORK/nasheed.mp3"

ROOT="$ROOT" WORK="$WORK" python3 - <<'PY'
import json, os
from pathlib import Path
root = Path(os.environ['ROOT'])
work = Path(os.environ['WORK'])
segments = [
  {'start':0.0,'end':3.5,'text':'Remember that every difficult moment can bring you closer to Allah.'},
  {'start':3.6,'end':7.2,'text':'The important question is what you do with the test in front of you.'},
  {'start':7.3,'end':10.7,'text':'Do not let one mistake convince you that the door of repentance is closed.'},
  {'start':10.8,'end':14.2,'text':'Return sincerely, repair what you can, and continue moving forward.'},
  {'start':14.3,'end':17.7,'text':'A believer keeps hope while taking responsibility for every action.'},
]
job = {
  'id':'smoke_project', 'url':str(work/'input.mp4'), 'title':'Smoke lecture',
  'sourceDir':str(work/'source'), 'outputDir':str(work/'out'),
  'resultPath':str(work/'job/result.json'), 'ffmpeg':'ffmpeg', 'ffprobe':'ffprobe',
  'template':json.loads((root/'src/templates/deenclipped-gold.json').read_text()),
  'musicTracks':[{'id':'music','name':'Test Nasheed','path':str(work/'nasheed.mp3')}],
  'transcriptSegments':segments,
  'settings':{'clipMinSeconds':6,'clipMaxSeconds':12,'clipsPerVideo':2,
              'musicVolumePercent':13,'maxSourceMinutes':5,'model':'tiny',
              'device':'cpu','computeType':'int8','task':'translate','language':''},
}
(work/'job/job.json').write_text(json.dumps(job, indent=2))
PY

python3 "$ROOT/worker/clip_worker.py" "$WORK/job/job.json"
python3 - <<PY
import json
result=json.load(open('$WORK/job/result.json'))
assert len(result['clips']) == 2
assert all(c['musicVerified'] and c['renderVerified'] for c in result['clips'])
print('Smoke test passed:', [c['id'] for c in result['clips']])
PY
ffprobe -v error -show_entries stream=codec_type,codec_name -of json "$WORK/out/smoke_project-01.mp4"
