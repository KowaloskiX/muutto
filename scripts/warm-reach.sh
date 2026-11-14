#!/usr/bin/env bash
# Pre-compute drive-time maps for demo workplaces (road isochrones every minute + region grid) so the
# Drive time layer opens instantly. Results are kept on disk for 24 h (see src/lib/move/reach-disk.ts).
# Usage: scripts/warm-reach.sh [base-url]
BASE="${1:-http://localhost:3000}"
# Wolt HQ (Arkadiankatu 6), Nokia (Karakaari 7, Espoo), Helsinki-Vantaa airport, Supercell (Jätkäsaari), Aalto Otaniemi
for P in "60.171,24.934" "60.222,24.756" "60.317,24.963" "60.159,24.915" "60.186,24.828"; do
  LAT=${P%,*}; LNG=${P#*,}
  for Q in "step=5" "step=1"; do curl -s -o /dev/null -w "iso $P $Q %{http_code} %{time_total}s\n" "$BASE/api/move/iso?lat=$LAT&lng=$LNG&$Q"; done
  for Q in "scale=city" "scale=region"; do curl -s -o /dev/null -w "heat $P $Q %{http_code} %{time_total}s\n" "$BASE/api/move/heat?lat=$LAT&lng=$LNG&$Q"; done
done
