#!/bin/bash
# Borra los datos de una persona o de una empresa (por ejemplo, ante un pedido de privacidad).
# Uso en el servidor:
#   bash deploy/borrar.sh <email>              Todo lo de ese email: usuario, empresas, diagnósticos, eventos y emails enviados.
#   bash deploy/borrar.sh --empresa <id>       Una empresa puntual, con sus diagnósticos. Sus usuarios no se borran.
#   bash deploy/borrar.sh --registro [email]   Qué se borró y cuándo (si das un email, solo lo de ese email).
# Antes de borrar muestra todo lo que hay y pide escribir BORRAR. Si la empresa la usan otras personas, pregunta
# si borrar solo al usuario o también la empresa. Queda un registro sin los datos borrados (tabla registro_borrados).
set -e
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "No encuentro el archivo .env. Primero corré: bash deploy/db-instalar.sh"; exit 1; }
[ $# -ge 1 ] || { echo "Uso: bash deploy/borrar.sh <email>   |   --empresa <id>   |   --registro [email]"; exit 1; }
node db/borrar.js "$@"
