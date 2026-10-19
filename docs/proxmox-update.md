# Обновление Proxmox LXC из персонального форка

`ct/librechat.sh` — адаптированная копия обновлятора community-scripts для
**уже установленного** LibreChat. Она устанавливает последний коммит ветки
`main` из `ashirkov-c-arlo/LibreChat`, собирает приложение
и перезапускает службы. RAG API обновляется из `danny-avila/rag_api`, как раньше.
Новая установка контейнера этим скриптом не поддерживается.

## Перед переключением

1. Закоммить и запушь `ct/librechat.sh`, `ct/librechat.test.sh` и этот документ
   в `main`. Репозиторий и ветка должны быть доступны
   контейнеру без GitHub-аутентификации.
2. Сделай полный backup контейнера в Proxmox, желательно с остановкой контейнера.
   Это точка отката для приложения, MongoDB, PostgreSQL и конфигурации.
3. Проверь нестандартные локальные файлы внутри `/opt/librechat`.

Обновление полностью заменяет `/opt/librechat`. Перед заменой скрипт сохраняет
и затем восстанавливает следующие пути:

- `.env`, `.npmrc`, `librechat.yaml`, `librechat.yml`;
- `uploads`, `data`, `api/data`, `logs`;
- `images`, `client/public/images`.

Предупреждения об отсутствующих путях нормальны. Если `CONFIG_PATH` указывает
на другой файл внутри `/opt/librechat`, или там лежат дополнительные секреты,
сертификаты, локальные плагины или данные, добавь их в `create_backup` перед
первым обновлением. Файлы вне `/opt/librechat` скрипт LibreChat не удаляет.
Данные MongoDB, PostgreSQL и Meilisearch не находятся в этой директории.

## Однократное переключение

Выполни **внутри LXC с LibreChat под root**, не в консоли хоста Proxmox.
Команды сначала проверяют доступность и синтаксис нового скрипта, затем меняют
только адрес репозитория скриптов в существующем `/usr/bin/update`.

```bash
bash <<'BASH'
set -euo pipefail
base='https://raw.githubusercontent.com/ashirkov-c-arlo/LibreChat/main'
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL "$base/ct/librechat.sh" -o "$tmp/librechat.sh"
bash -n "$tmp/librechat.sh"
grep -Fq 'check_for_gh_branch "librechat" "ashirkov-c-arlo/LibreChat" "main"' "$tmp/librechat.sh"
grep -Fq 'fetch_and_deploy_gh_branch "librechat" "ashirkov-c-arlo/LibreChat" "main"' "$tmp/librechat.sh"
grep -qx 'export UPDATE_SCRIPT_NAME="librechat"' /usr/bin/update

if [[ ! -e /root/update.librechat-upstream.bak ]]; then
  cp -a /usr/bin/update /root/update.librechat-upstream.bak
fi
sed "s|^export COMMUNITY_SCRIPTS_URL=.*|export COMMUNITY_SCRIPTS_URL=\"$base\"|" \
  /usr/bin/update >"$tmp/update"
grep -Fx "export COMMUNITY_SCRIPTS_URL=\"$base\"" "$tmp/update"
bash -n "$tmp/update"
install -m 755 "$tmp/update" /usr/bin/update
BASH
```

Теперь запускай штатную команду:

```bash
update
systemctl --no-pager --full status librechat rag-api
```

При первом запуске приложение будет переустановлено из форка. Дальше наличие
обновления определяется по SHA коммита ветки, а не по релизным тегам.
Официальные библиотека community-scripts, меню обновления и проверка статуса
скрипта остаются прежними. Адрес твоего репозитория сохраняется в entrypoint.

Не переименовывай и не удаляй ветку без изменения адреса в `/usr/bin/update`
и обоих вызовов branch-функций в `ct/librechat.sh`.

## Обычное обновление

Вручную мерджишь изменения оригинального LibreChat в `main` форка, проверяешь
приложение, пушишь `main` на GitHub, затем запускаешь `update` в контейнере.
Скрипт не делает merge на сервере: сервер только устанавливает твою ветку.

## Ошибки и возврат к upstream

Автоматического отката нет. При неудачной сборке службы могут остаться
остановленными, а записанный SHA — уже обновлённым. Не рассчитывай, что обычный
повторный `update` обязательно повторит сборку. Используй полный backup
контейнера для восстановления; сохранение отдельных файлов не заменяет его.

Чтобы вернуть **источник будущих обновлений** на официальный репозиторий:

```bash
install -m 755 /root/update.librechat-upstream.bak /usr/bin/update
```

Это не откатывает установленное приложение или базу данных. Штатный upstream
обновлятор сохраняет только `.env`, поэтому перед его запуском снова сделай
полный backup контейнера: локальные загрузки и конфигурация могут быть удалены.

## Проверка скрипта в репозитории

```bash
bash -n ct/librechat.sh ct/librechat.test.sh
bash ct/librechat.test.sh
```

Проверка не скачивает community-scripts и ничего не меняет на сервере: она
подставляет заглушки для системных команд и проверяет порядок сохранения,
развёртывания, восстановления, сборки и перезапуска, отсутствие действий при
неизменившейся ветке и отказ при отсутствии установки. Реальное обновление LXC
этой проверкой не покрывается.
