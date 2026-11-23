#!/usr/bin/env bash
# Installs the Solidity dependencies into contracts/lib at pinned commits (they are not vendored in git).
#   cd contracts && ./install.sh && forge test
set -euo pipefail
cd "$(dirname "$0")"
forge install --no-git \
  "foundry-rs/forge-std@15b2df92a05d4d2f76a06653872fefb287e0e01c" \
  "Uniswap/v4-periphery@c6e4754dab11bd38c6f08ac51c3c868569e93d64"
