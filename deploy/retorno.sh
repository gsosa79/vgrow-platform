#!/bin/bash
# Email mensual de retorno: revisa ahora a quién le toca y le manda (la app ya lo hace sola una vez por día).
# Uso en el servidor:  bash deploy/retorno.sh
# Nunca manda dos veces el mismo email: correrlo de más no repite nada.
# Con EMAIL_MODO=prueba no sale nada: los emails quedan en data/emails.log.
set -e
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "No encuentro el archivo .env. Primero corré: bash deploy/db-instalar.sh"; exit 1; }
node servidor/retorno.js
