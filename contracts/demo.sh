#!/usr/bin/env bash
# BellHook end-to-end demo: dark fee → onchain bell → priority-fee auction → live, with a table decoded
# from the hook's own events.
#
#   Local rehearsal (anvil):   anvil --silent &   ./demo.sh local
#   Base Sepolia:              ACCOUNT=<foundry keystore name> ./demo.sh sepolia
#                              (create one with: cast wallet import <name> --interactive; fund it from a
#                               Base Sepolia faucet. The script never sees or stores your key.)
#
# Uses the Uniswap v4 PoolManager and test routers already deployed on Base Sepolia (verified on-chain).
set -euo pipefail
cd "$(dirname "$0")"
MODE="${1:-local}"

case "$MODE" in
  local)
    RPC="${RPC:-http://127.0.0.1:8545}"
    # anvil's standard dev account, derived from its public test mnemonic (not a secret)
    SIGN=(--private-key "$(cast wallet private-key 'test test test test test test test test test test test junk' 0)")
    cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 || { echo "No node at $RPC. Start one:  anvil --silent &"; exit 1; }
    ;;
  sepolia)
    RPC="${RPC:-https://sepolia.base.org}"
    : "${ACCOUNT:?set ACCOUNT to a Foundry keystore name (cast wallet import <name> --interactive)}"
    SIGN=(--account "$ACCOUNT")
    [ -n "${PASSWORD_FILE:-}" ] && SIGN+=(--password-file "$PASSWORD_FILE")
    export POOL_MANAGER=0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408
    # Base Sepolia makes ~5 blocks/s and each forge script takes 10-30s, so widen both windows
    export DEMO_DARK_GAP_S="${DEMO_DARK_GAP_S:-150}" DEMO_AUCTION_BLOCKS="${DEMO_AUCTION_BLOCKS:-200}"
    export SWAP_ROUTER=0x8b5bcc363dde2614281ad875bad385e0a785d3b9
    export LIQ_ROUTER=0x37429cd17cb1454c34e7f50b09725202fd533039
    [ "$(cast chain-id --rpc-url "$RPC")" = "84532" ] || { echo "RPC is not Base Sepolia (84532)"; exit 1; }
    ;;
  *) echo "usage: ./demo.sh local|sepolia"; exit 1 ;;
esac

run() {
  local out
  out=$(forge script script/DemoBell.s.sol --tc DemoBell --rpc-url "$RPC" --broadcast "${SIGN[@]}" "$@" 2>&1) || { echo "$out" | tail -25; exit 1; }
  echo "$out" | grep -E "BellHook |Pool initialised" || true
}
ONE_HUNDRED_USDC=100000000

wait_secs() {  # advance simulated (local) or real (testnet) time
  if [ "$MODE" = local ]; then cast rpc evm_increaseTime "$1" --rpc-url "$RPC" >/dev/null; cast rpc evm_mine --rpc-url "$RPC" >/dev/null
  else echo "   …waiting ${1}s"; sleep "$1"; fi
}
wait_blocks() {
  if [ "$MODE" = local ]; then cast rpc anvil_mine "$1" --rpc-url "$RPC" >/dev/null
  else
    local target=$(( $(cast block-number --rpc-url "$RPC") + $1 ))
    echo "   …waiting for $1 blocks"
    while [ "$(cast block-number --rpc-url "$RPC")" -lt "$target" ]; do sleep 2; done
  fi
}

echo "▸ 1/6  Deploy mock tokens, a mock equity feed, BellHook and a funded pool"
run --sig "setup()"
set -a; source demo/state.env; set +a
START=$(cast block-number --rpc-url "$RPC")
echo "   hook $HOOK   (dark gap ${MIN_DARK_GAP_S}s, auction ${AUCTION_BLOCKS} blocks)"

echo "▸ 2/6  Market open: the feed is fresh → LIVE fee"
run --sig "swap(uint256)" "$ONE_HUNDRED_USDC"

echo "▸ 3/6  Market closes: no feed update for ${MIN_DARK_GAP_S}s+ → DARK fee"
wait_secs $(( MIN_DARK_GAP_S + 5 ))
run --sig "swap(uint256)" "$ONE_HUNDRED_USDC"

echo "▸ 4/6  The reopen: the feed prints a new price. The hook rings the bell by itself"
run --sig "push(int256)" 13350000000
echo "      searcher A bids 0.001 gwei of priority fee"
run --sig "swap(uint256)" "$ONE_HUNDRED_USDC" --priority-gas-price 1000000
echo "      searcher B bids 0.004 gwei"
run --sig "swap(uint256)" "$ONE_HUNDRED_USDC" --priority-gas-price 4000000

echo "▸ 5/6  Auction window over → back to LIVE"
wait_blocks $(( AUCTION_BLOCKS + 2 ))
run --sig "swap(uint256)" "$ONE_HUNDRED_USDC"

echo "▸ 6/6  What the hook recorded onchain"
python3 - "$RPC" "$HOOK" "$START" <<'EOF'
import json, subprocess, sys
rpc, hook, start = sys.argv[1:4]
PH = ["LIVE", "DARK", "AUCTION"]
def logs(sig):
    head = int(subprocess.run(["cast", "block-number", "--rpc-url", rpc], capture_output=True, text=True).stdout.strip())
    res, a = [], int(start)
    while a <= head:  # public RPCs cap eth_getLogs at 200 blocks
        b = min(a + 150, head)
        out = subprocess.run(["cast", "logs", "--rpc-url", rpc, "--from-block", str(a), "--to-block", str(b), "--address", hook, "--json", sig], capture_output=True, text=True).stdout
        res += json.loads(out) if out.strip() else []
        a = b + 1
    return res
def words(d): d = d[2:]; return [int(d[i:i + 64], 16) for i in range(0, len(d), 64)]
rows = []
for l in logs("FeeApplied(bytes32,uint8,uint24,uint256)"):
    ph, fee, prio = words(l["data"])
    rows.append((int(l["blockNumber"], 16), int(l["logIndex"], 16), "swap", PH[ph], fee / 1e4, prio / 1e9, l["transactionHash"]))
for l in logs("Bell(bytes32,uint64,uint64,uint64)"):
    _, dark, end = words(l["data"])
    rows.append((int(l["blockNumber"], 16), int(l["logIndex"], 16) - 0.5, "bell", "BELL", None, dark, l["transactionHash"]))
rows.sort()
print(f"\n  {'block':>9}  {'event':<5} {'phase':<8} {'swap fee':>9}  {'priority fee':>14}   tx")
for b, _, kind, ph, fee, x, tx in rows:
    if kind == "bell":
        print(f"  {b:>9}  {'bell':<5} {ph:<8} {'':>9}  {'dark ' + str(int(x)) + 's':>14}   {tx[:12]}…")
    else:
        print(f"  {b:>9}  {'swap':<5} {ph:<8} {fee:>8.2f}%  {x:>9.4f} gwei   {tx[:12]}…")
print()
EOF
