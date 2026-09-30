#!/bin/bash
# Conecta la plataforma a la base MySQL de RDS (se corre una sola vez).
set -e
cd /home/ubuntu/vgrow-platform

echo "== 1/6 Instalando el cliente de MySQL =="
sudo apt-get install -y -qq mysql-client >/dev/null

echo "== 2/6 Descargando el certificado de seguridad de RDS =="
curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o db/rds-ca.pem

echo "== 3/6 Datos de la base =="
read -r -p "Pegá el Punto de conexión (termina en .rds.amazonaws.com): " EP
EP=$(echo "$EP" | tr -d '[:space:]')
read -r -s -p "Contraseña del usuario admin de la base: " ADMINPASS; echo
export MYSQL_PWD="$ADMINPASS"
M="mysql --ssl-ca=db/rds-ca.pem --ssl-mode=VERIFY_IDENTITY -h $EP -u admin"
$M -e "SELECT 'Conexión OK' AS estado;" || { echo "No se pudo conectar. Revisá el punto de conexión y la contraseña."; exit 1; }

echo "== 4/6 Creando las tablas y el usuario de la aplicación =="
$M -e "CREATE DATABASE IF NOT EXISTS vgrow CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
$M vgrow < db/schema.sql
APPPASS=$(openssl rand -hex 20)
$M -e "CREATE USER IF NOT EXISTS 'vgrow_app'@'%' IDENTIFIED BY '$APPPASS';
       ALTER USER 'vgrow_app'@'%' IDENTIFIED BY '$APPPASS';
       GRANT SELECT, INSERT, UPDATE, DELETE ON vgrow.* TO 'vgrow_app'@'%';"
unset MYSQL_PWD

echo "== 5/6 Guardando la configuración =="
touch .env
sed -i '/^DB_/d' .env
printf "DB_HOST=%s\nDB_USER=vgrow_app\nDB_PASS=%s\nDB_NAME=vgrow\n" "$EP" "$APPPASS" >> .env
chmod 600 .env

echo "== 6/6 Actualizando la app =="
npm install --omit=dev --no-audit --no-fund
node db/importar-archivo.js
node db/cargar-datos.js
pm2 restart vgrow --update-env >/dev/null
sleep 2
echo ""
curl -s localhost:3000/api/salud; echo
echo "LISTO. Si arriba dice \"db\":true, la plataforma ya guarda en la base de datos."
