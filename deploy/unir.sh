#!/bin/bash
# Une dos empresas que son la misma (las marca /admin, en "Posibles duplicados").
# Uso en el servidor:  bash deploy/unir.sh <id_que_queda> <id_que_se_borra>
# Pasa a la que queda los usuarios y los diagnósticos de la otra, y borra la otra. Muestra las dos y pide escribir UNIR.
# La que queda mantiene su nombre, su email y su plan. Queda registrado en la tabla registro_borrados.
set -e
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "No encuentro el archivo .env. Primero corré: bash deploy/db-instalar.sh"; exit 1; }
[ $# -eq 2 ] || { echo "Uso: bash deploy/unir.sh <id_que_queda> <id_que_se_borra>"; exit 1; }
node db/unir.js "$@"
