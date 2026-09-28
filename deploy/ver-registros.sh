#!/bin/bash
# Muestra las últimas empresas registradas.
cd /home/ubuntu/vgrow-platform
set -a; . ./.env; set +a
MYSQL_PWD="$DB_PASS" mysql --ssl-ca=db/rds-ca.pem -h "$DB_HOST" -u "$DB_USER" "$DB_NAME" -t -e "
SELECT e.id, e.nombre AS empresa, e.email, e.sector, e.pais, e.ultimo_score AS score, e.ultimo_semaforo AS semaforo,
       (SELECT COUNT(*) FROM diagnosticos d WHERE d.empresa_id=e.id) AS diags, DATE_FORMAT(e.actualizado,'%d/%m %H:%i') AS ultimo
FROM empresas e ORDER BY e.actualizado DESC LIMIT ${1:-20};
SELECT COUNT(*) AS empresas_total FROM empresas;"
