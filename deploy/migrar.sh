#!/bin/bash
# Crea las tablas nuevas de identidad y arquitectura y agrega las columnas que faltan.
# Uso en el servidor:  bash deploy/migrar.sh
# Se puede correr las veces que haga falta: no borra nada y solo agrega lo que falta.
set -e
SCRIPT="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SCRIPT")/.."

# Primero trae la última versión de main y vuelve a arrancar este script ya actualizado.
if [ -z "$VG_ACTUALIZADO" ] && [ -f deploy/actualizar.sh ] && [ -z "$SIN_ACTUALIZAR" ]; then
  echo "== 1/4 Bajando la última versión =="
  bash deploy/actualizar.sh || echo "(no se pudo actualizar; sigo con la versión que hay)"
  VG_ACTUALIZADO=1 exec bash "$SCRIPT" "$@"
fi

[ -f .env ] || { echo "No encuentro el archivo .env. Primero corré: bash deploy/db-instalar.sh"; exit 1; }
set -a; . ./.env; set +a
[ -n "$DB_HOST" ] || { echo "El .env no tiene DB_HOST. Primero corré: bash deploy/db-instalar.sh"; exit 1; }
DB_NAME=${DB_NAME:-vgrow}

echo "== 2/4 Creando las tablas nuevas =="
if [ -z "$ADMIN_PASS" ]; then read -r -s -p "Contraseña del usuario admin de la base: " ADMIN_PASS; echo; fi
export MYSQL_PWD="$ADMIN_PASS"
SSL=""
[ -f db/rds-ca.pem ] && SSL="--ssl-ca=db/rds-ca.pem --ssl-mode=VERIFY_IDENTITY"
mysql --default-character-set=utf8mb4 $SSL -h "$DB_HOST" -u "${ADMIN_USER:-admin}" "$DB_NAME" < db/schema.sql || { echo "No se pudo conectar como admin. Revisá la contraseña."; exit 1; }
unset MYSQL_PWD

echo "== 3/4 Agregando las columnas nuevas =="
ADMIN_PASS="$ADMIN_PASS" node db/migrar.js

echo "== 4/4 Reiniciando la app =="
pm2 reload vgrow --update-env >/dev/null 2>&1 || true
sleep 2
curl -s "localhost:${PORT:-3000}/api/salud"; echo
echo "LISTO. Arriba tiene que decir \"db\":true. El login sigue apagado hasta que pongas LOGIN_HABILITADO=1 en el .env."
