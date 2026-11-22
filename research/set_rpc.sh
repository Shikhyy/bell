#!/usr/bin/env bash
# Saves your Base RPC URL into research/.env without echoing it or touching shell history.
set -euo pipefail
cd "$(dirname "$0")"
read -rsp "Paste your NEW (rotated) Base RPC URL, then press Enter: " url
echo
case "$url" in
  https://*) ;;
  *) echo "That doesn't look like an https URL. Nothing saved."; exit 1 ;;
esac
umask 077
printf 'BASE_ARCHIVE_RPC_URL=%s\n' "$url" > .env
unset url
echo "Saved to research/.env (only you can read it)."
