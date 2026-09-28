#!/bin/bash
# Instalación inicial en el servidor (se corre una sola vez).
set -e
cd /home/ubuntu/vgrow-platform

echo "== 1/5 Instalando dependencias =="
npm install --omit=dev --no-audit --no-fund

echo "== 2/5 Configurando la clave de IA =="
if [ ! -f .env ]; then
  read -r -s -p "Pegá la API key de Anthropic (o Enter para dejarla para después): " KEY; echo
  printf "PORT=3000\nANTHROPIC_API_KEY=%s\nANTHROPIC_MODEL=claude-sonnet-5\n" "$KEY" > .env
  chmod 600 .env
fi

echo "== 3/5 Arrancando la app con PM2 =="
pm2 delete vgrow >/dev/null 2>&1 || true
pm2 start app.js --name vgrow
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu >/dev/null
pm2 save

echo "== 4/5 Configurando Nginx =="
sudo cp deploy/nginx-vgrow.conf /etc/nginx/sites-available/vgrow
sudo ln -sf /etc/nginx/sites-available/vgrow /etc/nginx/sites-enabled/vgrow
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo "== 5/5 Actualización automática cada 5 minutos =="
chmod +x deploy/actualizar.sh
( crontab -l 2>/dev/null | grep -v actualizar.sh; echo "*/5 * * * * /home/ubuntu/vgrow-platform/deploy/actualizar.sh >> /home/ubuntu/actualizar.log 2>&1" ) | crontab -

echo ""
echo "LISTO. Probá en el navegador: http://$(curl -s ifconfig.me)"
