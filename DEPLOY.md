# Инструкция по развертыванию на сервере

## Сервер
- IP: 91.186.197.89
- Пользователь: root
- Пароль: sP+FkvHKi-7,W2

## Вариант 1: Автоматическое развертывание

```bash
chmod +x deploy.sh
./deploy.sh
```

## Вариант 2: Ручное развертывание

### 1. Подключиться к серверу

```bash
ssh root@91.186.197.89
# Пароль: sP+FkvHKi-7,W2
```

### 2. Создать директорию проекта

```bash
mkdir -p /var/www/togyzqumalaq/{static,game_logs}
cd /var/www/togyzqumalaq
```

### 3. Скопировать файлы

На локальной машине:

```bash
# Из директории проекта
scp index.html styles.css game.js mcts-worker.js root@91.186.197.89:/var/www/togyzqumalaq/static/
scp server.py requirements.txt root@91.186.197.89:/var/www/togyzqumalaq/
```

### 4. Установить зависимости Python

На сервере:

```bash
cd /var/www/togyzqumalaq
pip3 install -r requirements.txt
# Или если pip3 нет:
python3 -m pip install -r requirements.txt
```

### 5. Создать systemd service для Flask сервера

```bash
cat > /etc/systemd/system/togyzqumalaq-logger.service << 'EOF'
[Unit]
Description=TogyzQumalaq Game Logger Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/togyzqumalaq
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
ExecStart=/usr/bin/python3 /var/www/togyzqumalaq/server.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
```

### 6. Запустить сервис

```bash
systemctl daemon-reload
systemctl enable togyzqumalaq-logger
systemctl start togyzqumalaq-logger
systemctl status togyzqumalaq-logger
```

### 7. Настроить Nginx

```bash
cat > /etc/nginx/sites-available/togyzqumalaq << 'EOF'
server {
    listen 80;
    server_name 91.186.197.89;

    # Статические файлы игры
    location / {
        root /var/www/togyzqumalaq/static;
        index index.html;
        try_files $uri $uri/ =404;
    }

    # API для логирования
    location /api {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
```

### 8. Активировать конфигурацию Nginx

```bash
ln -sf /etc/nginx/sites-available/togyzqumalaq /etc/nginx/sites-enabled/
nginx -t  # Проверка конфигурации
systemctl reload nginx
```

### 9. Проверить работу

- Игра: http://91.186.197.89
- API Health: http://91.186.197.89/api/health

## Полезные команды

```bash
# Статус сервиса
systemctl status togyzqumalaq-logger

# Перезапуск сервиса
systemctl restart togyzqumalaq-logger

# Логи сервиса
journalctl -u togyzqumalaq-logger -f

# Логи Nginx
tail -f /var/log/nginx/error.log

# Проверка портов
netstat -tlnp | grep 5000
```

## Структура на сервере

```
/var/www/togyzqumalaq/
├── static/
│   ├── index.html
│   ├── styles.css
│   ├── game.js
│   └── mcts-worker.js
├── game_logs/
│   └── games_YYYY-MM-DD.json
├── server.py
└── requirements.txt
```

## Обновление проекта

После изменений в коде:

```bash
# На локальной машине
scp index.html styles.css game.js mcts-worker.js root@91.186.197.89:/var/www/togyzqumalaq/static/
scp server.py root@91.186.197.89:/var/www/togyzqumalaq/

# На сервере
systemctl restart togyzqumalaq-logger
```

## Резервное копирование данных

```bash
# На сервере
tar -czf togyzqumalaq_backup_$(date +%Y%m%d).tar.gz /var/www/togyzqumalaq/game_logs/

# Скачать на локальную машину
scp root@91.186.197.89:/root/togyzqumalaq_backup_*.tar.gz ./
```

