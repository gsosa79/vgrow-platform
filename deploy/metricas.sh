#!/bin/bash
# Cuántos pidieron "Avisame cuando esté disponible", por plan y por módulo.
# Uso en el servidor:  bash deploy/metricas.sh        (todo)
#                      bash deploy/metricas.sh 30     (últimos 30 días)
set -e
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "No encuentro el archivo .env. Primero corré: bash deploy/db-instalar.sh"; exit 1; }
node db/metricas.js "$@"
