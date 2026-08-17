#!/usr/bin/env bash
# Remove the oversized 8B model pulled by mistake.
#
# Same reason as pull-model.sh: the Hetzner console's keyboard cannot type the
# ':' in a model tag, so the removal lives in a script too.
set -u
COMPOSE=(docker compose -f worker/docker-compose.yml)
echo "Removing qwen3 (the 8B build)..."
"${COMPOSE[@]}" exec -T ollama ollama rm qwen3 || true
echo
echo "Models now installed:"
"${COMPOSE[@]}" exec -T ollama ollama list
