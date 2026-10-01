#!/bin/bash
# Cambia a mano el plan de una empresa, mientras no haya pagos integrados.
# Uso en el servidor:  bash deploy/plan.sh <email> <freemium|basic|pro>
#   Si la cuenta tiene más de una empresa, el script las lista: agregá el id al final.
#   bash deploy/plan.sh dueno@empresa.com.uy pro 12
# Para volver a Free: bash deploy/plan.sh <email> freemium
set -e
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "No encuentro el archivo .env. Primero corré: bash deploy/db-instalar.sh"; exit 1; }
[ $# -ge 2 ] || { echo "Uso: bash deploy/plan.sh <email> <freemium|basic|pro> [id de la empresa]"; exit 1; }
node db/plan.js "$@"
