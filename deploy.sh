#!/bin/bash
# Скрипт развертывания Тоғызқұмалақ на сервере
# Требует sshpass: sudo apt-get install sshpass (или введите пароль вручную)

set -e

SERVER="root@91.186.197.89"
SERVER_PASS="sP+FkvHKi-7,W2"
SERVER_DIR="/var/www/togyzqumalaq"
SERVICE_NAME="togyzqumalaq-logger"

# Проверка наличия sshpass
if command -v sshpass &> /dev/null; then
    SSH_CMD="sshpass -p '$SERVER_PASS' ssh"
    SCP_CMD="sshpass -p '$SERVER_PASS' scp"
else
    echo "⚠️  sshpass не установлен. Будет запрошен пароль."
    echo "   Установите: sudo apt-get install sshpass"
    SSH_CMD="ssh"
    SCP_CMD="scp"
fi

echo "🚀 Начало развертывания Тоғызқұмалақ..."

# 1. Создать директорию на сервере
echo "📁 Создание директорий на сервере..."
$SSH_CMD $SERVER "mkdir -p $SERVER_DIR/{game_logs,static}"

# 2. Копировать файлы
echo "📦 Копирование файлов..."
$SCP_CMD index.html styles.css game.js mcts-worker.js $SERVER:$SERVER_DIR/static/
$SCP_CMD server.py requirements.txt setup_server.sh $SERVER:$SERVER_DIR/

# 3. Установить зависимости Python
echo "📥 Установка зависимостей Python..."
$SSH_CMD $SERVER "cd $SERVER_DIR && pip3 install -r requirements.txt || python3 -m pip install -r requirements.txt"

# 4. Создать systemd service для Flask сервера
echo "⚙️  Настройка systemd service..."
$SSH_CMD $SERVER "cat > /etc/systemd/system/$SERVICE_NAME.service << 'EOF'
[Unit]
Description=TogyzQumalaq Game Logger Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$SERVER_DIR
Environment=\"PATH=/usr/local/bin:/usr/bin:/bin\"
ExecStart=/usr/bin/python3 $SERVER_DIR/server.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
"

# 5. Создать конфигурацию nginx
echo "🌐 Настройка nginx..."
ssh $SERVER "cat > /etc/nginx/sites-available/togyzqumalaq << 'EOF'
server {
    listen 80;
    server_name 91.186.197.89;

    # Статические файлы игры
    location / {
        root $SERVER_DIR/static;
        index index.html;
        try_files \$uri \$uri/ =404;
    }

    # API для логирования
    location /api {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
"

# 6. Активировать nginx конфигурацию
echo "🔗 Активация nginx конфигурации..."
$SSH_CMD $SERVER "ln -sf /etc/nginx/sites-available/togyzqumalaq /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx"

# 7. Запустить и включить Flask сервис
echo "🔄 Запуск сервиса логирования..."
$SSH_CMD $SERVER "systemctl daemon-reload && systemctl enable $SERVICE_NAME && systemctl restart $SERVICE_NAME"

# 8. Проверить статус
echo "✅ Проверка статуса..."
$SSH_CMD $SERVER "systemctl status $SERVICE_NAME --no-pager -l"

echo ""
echo "✨ Развертывание завершено!"
echo "🌐 Игра доступна по адресу: http://91.186.197.89"
echo "📊 API доступен по адресу: http://91.186.197.89/api"
echo ""
echo "Полезные команды:"
echo "  systemctl status $SERVICE_NAME  - статус сервиса"
echo "  systemctl restart $SERVICE_NAME  - перезапуск сервиса"
echo "  journalctl -u $SERVICE_NAME -f   - логи сервиса"

