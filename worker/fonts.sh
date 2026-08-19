#!/usr/bin/env bash
# Which font families the worker image can actually draw with.
#
#   bash worker/fonts.sh
#
# In the repo rather than typed at a prompt because the Hetzner web console
# mangles pipes, brackets and underscores -- the same reason probe-import.sh
# exists.
set -u
CONTAINER="${CONTAINER:-worker-deenclipped-worker-1}"

echo "== families installed in the worker =="
docker exec "$CONTAINER" fc-list : family > /tmp/dc-fonts.txt 2>/dev/null
tr ',' '\n' < /tmp/dc-fonts.txt | sed 's/^ *//' | sort -u | grep -v '^$'

echo
echo "== the faces an ayah can be set in, in preference order =="
for family in "Amiri Quran" "Scheherazade New" "Scheherazade" "Amiri"; do
  if tr ',' '\n' < /tmp/dc-fonts.txt | sed 's/^ *//' | grep -qx "$family"; then
    echo "  present  $family"
  else
    echo "  MISSING  $family"
  fi
done
rm -f /tmp/dc-fonts.txt

echo
echo "== what the renderer would choose =="
docker exec "$CONTAINER" python -c "import sys; sys.path.insert(0,'/app/worker'); import clip_worker; print(clip_worker.quran_font('DejaVu Sans'))" 2>/dev/null
