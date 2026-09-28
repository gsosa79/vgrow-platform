#!/bin/bash
# Se ejecuta cada 5 minutos: si hay cambios en la rama main de GitHub, los baja y reinicia la app.
cd /home/ubuntu/vgrow-platform || exit 1
git fetch -q origin main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  CAMBIO_PAQUETES=$(git diff --name-only HEAD origin/main | grep -c package.json)
  git reset -q --hard origin/main
  if [ "$CAMBIO_PAQUETES" -gt 0 ]; then npm install --omit=dev --no-audit --no-fund; fi
  pm2 reload vgrow --update-env
  echo "$(date '+%F %T') actualizado a $(git rev-parse --short HEAD)"
fi
