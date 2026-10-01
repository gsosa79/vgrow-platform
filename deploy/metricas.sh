#!/bin/bash
# Métricas de la plataforma: embudo, empresas activadas, segunda carga, IA por día y plan, "Avisame" y email mensual.
# Uso en el servidor:  bash deploy/metricas.sh        (últimos 30 días)
#                      bash deploy/metricas.sh 7      (últimos 7 días)
# También están en https://<tu dominio>/api/metricas para el administrador (ADMIN_EMAILS, con sesión).
set -e
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "No encuentro el archivo .env. Primero corré: bash deploy/db-instalar.sh"; exit 1; }
node db/metricas.js "$@"
