#!/bin/bash
# Pasa a la base de datos el dataset de referencia (35 empresas) y los benchmarks por sector.
# Uso en el servidor:  bash deploy/cargar-datos.sh
# Se puede correr las veces que haga falta: actualiza los datos, no los duplica.
set -e
SCRIPT="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SCRIPT")/.."

# Primero trae la última versión de main (y reinicia la app si hubo cambios), y vuelve a arrancar
# este script ya actualizado.
if [ -z "$VG_ACTUALIZADO" ] && [ -f deploy/actualizar.sh ] && [ -z "$SIN_ACTUALIZAR" ]; then
  echo "== 1/4 Bajando la última versión =="
  bash deploy/actualizar.sh || echo "(no se pudo actualizar; sigo con la versión que hay)"
  VG_ACTUALIZADO=1 exec bash "$SCRIPT" "$@"
fi

[ -f .env ] || { echo "No encuentro el archivo .env. Primero corré: bash deploy/db-instalar.sh"; exit 1; }
set -a; . ./.env; set +a
[ -n "$DB_HOST" ] || { echo "El .env no tiene DB_HOST. Primero corré: bash deploy/db-instalar.sh"; exit 1; }
DB_NAME=${DB_NAME:-vgrow}

echo "== 2/4 Creando las tablas que falten =="
if [ -z "$ADMIN_PASS" ]; then read -r -s -p "Contraseña del usuario admin de la base: " ADMIN_PASS; echo; fi
export MYSQL_PWD="$ADMIN_PASS"
SSL=""
[ -f db/rds-ca.pem ] && SSL="--ssl-ca=db/rds-ca.pem --ssl-mode=VERIFY_IDENTITY"
M="mysql --default-character-set=utf8mb4 $SSL -h $DB_HOST -u ${ADMIN_USER:-admin}"
$M "$DB_NAME" < db/schema.sql || { echo "No se pudo conectar como admin. Revisá la contraseña."; exit 1; }
unset MYSQL_PWD

echo "== 3/4 Cargando el dataset y los benchmarks =="
node db/cargar-datos.js

echo "== 4/4 Comprobando lo que responde la plataforma =="
# Reinicia la app para que no muestre datos viejos guardados en memoria
pm2 reload vgrow --update-env >/dev/null 2>&1 || true
sleep 2
PUERTO=${PORT:-3000}
for ruta in dataset benchmarks; do
  R=$(curl -s "localhost:$PUERTO/api/$ruta" || true)
  echo "/api/$ruta → $(echo "$R" | node -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>{try{const j=JSON.parse(t);console.log(j.total!=null?j.total+" registros":(j.error||t))}catch{console.log("la app no respondió (¿está corriendo?)")}})')"
done
echo "LISTO. Si arriba dice 35 registros y 10 registros, la plataforma ya toma los datos de la base."
