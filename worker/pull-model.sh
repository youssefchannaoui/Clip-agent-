#!/usr/bin/env bash
# Pull the clip-AI model into the ollama container.
#
# This exists because the Hetzner web console runs a German keyboard layout that
# mangles ':' into ';' and '$' into '4', which makes `ollama pull qwen3:4b`
# impossible to type there by hand. Every character in `bash worker/pull-model.sh`
# survives that layout.
#
# Usage:  bash worker/pull-model.sh            # pulls the default model
#         OLLAMA_MODEL=qwen3:8b bash worker/pull-model.sh
set -u

MODEL="${OLLAMA_MODEL:-qwen3:4b}"
COMPOSE=(docker compose -f worker/docker-compose.yml)

echo "Pulling ${MODEL} into the ollama container..."
echo
if ! "${COMPOSE[@]}" exec -T ollama ollama pull "${MODEL}"; then
  echo
  echo "Pull failed. Is the ollama container up?"
  echo "  docker compose -f worker/docker-compose.yml up -d"
  exit 1
fi

echo
echo "Models now installed:"
"${COMPOSE[@]}" exec -T ollama ollama list

# The 8B build is roughly 5.2GB and will not fit beside transcription on a CPX22.
# Only 4B is expected here, so say so rather than leaving it to be discovered
# when a job OOMs mid-render.
if "${COMPOSE[@]}" exec -T ollama ollama list 2>/dev/null | grep -qE '^qwen3(:latest)?[[:space:]]'; then
  echo
  echo "NOTE: the 8B 'qwen3' model is also installed and is too big for this box."
  echo "Free 5.2GB of disk with:"
  echo "  bash worker/remove-model.sh"
fi

echo
echo "Now confirm the worker sees it:"
echo "  bash worker/verify-deploy.sh"
