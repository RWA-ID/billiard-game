#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Pin the billiard.eth static export (out/) to IPFS via Pinata.
#
# Usage:
#   npm run build           # emit out/ first (with NEXT_PUBLIC_WS_URL set)
#   PINATA_JWT="eyJ…" bash pin.sh
#
# Outputs a CIDv1 + gateway URLs. Paste ipfs://<cid> into the billiard.eth
# ENS contenthash field. CIDv1 is required for *.eth.link gateway compatibility.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="$ROOT/out"
NAME="${PIN_NAME:-billiard.eth $(date -u +%Y-%m-%d)}"

if [[ ! -d "$DIR" ]]; then
  echo "✗ $DIR not found — run 'npm run build' first" >&2
  exit 1
fi
if [[ -z "${PINATA_JWT:-}" ]]; then
  echo "✗ PINATA_JWT env var is required" >&2
  echo "  Usage: PINATA_JWT='eyJ…' bash $0" >&2
  exit 1
fi

echo "▶ Pinning $DIR  ($(du -sh "$DIR" | cut -f1))"

# One -F entry per file. The shared top-level segment ("out") becomes the
# directory whose CID is returned, so index.html sits at <cid>/index.html.
FILES=()
while IFS= read -r f; do
  rel="${f#$DIR/}"
  FILES+=(-F "file=@${f};filename=out/${rel}")
done < <(find "$DIR" -type f ! -name '.DS_Store' ! -path '*/.git/*')

echo "  ${#FILES[@]} files → POST pinFileToIPFS (cidVersion 1)"

RESPONSE=$(curl -sS -X POST https://api.pinata.cloud/pinning/pinFileToIPFS \
  -H "Authorization: Bearer ${PINATA_JWT}" \
  -F "pinataMetadata={\"name\":\"${NAME}\"}" \
  -F 'pinataOptions={"cidVersion":1,"wrapWithDirectory":false}' \
  "${FILES[@]}")

CID=$(echo "$RESPONSE" | python3 -c "import json,sys;print(json.load(sys.stdin).get('IpfsHash',''))" 2>/dev/null || true)

if [[ -z "$CID" ]]; then
  echo "✗ Pin failed — full response:" >&2
  echo "$RESPONSE" >&2
  exit 1
fi

echo
echo "✓ Pinned successfully"
echo "  CID:      $CID"
echo "  Gateway:  https://${CID}.ipfs.dweb.link/"
echo "  Pinata:   https://gateway.pinata.cloud/ipfs/$CID/"
echo "  ENS:      ipfs://$CID"
echo
echo "Paste  ipfs://$CID  into the billiard.eth contenthash (ENS Manager)."
