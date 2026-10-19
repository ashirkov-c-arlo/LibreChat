# Патч-серия: inline Thinking Effort selector (база v0.8.8-rc1)

## Что изменилось относительно плана

Бэкенд-часть плана (§8 каноническое поле, §12 payload, §13 provider mapping,
§14 серверная валидация) **не реализовывалась — она уже есть в v0.8.8-rc1**:

| План | Состояние в v0.8.8-rc1 |
|---|---|
| канон. поле `thinkingEffort` | не нужно: `effort` (AnthropicEffort) и `reasoning_effort` (ReasoningEffort) уже в `tConversationSchema`, `tPresetSchema` и mongoose (`packages/data-schemas/src/schema/defaults.ts`) |
| персистентность на уровне разговора (§8.4) | из коробки, оба поля — обычные conversation params |
| provider mapping (§13) | `packages/data-provider/src/bedrock.ts`: Claude → `output_config` + удаление `reasoning_effort`; не-Claude → `reasoning_config` по allowlist + удаление `effort`/`thinking*` |
| Qwen не получает effort-полей (§13) | там же, ветка не-Claude + чистка stale `additionalModelRequestFields` |

§8.1 это прямо разрешает («если в v0.8.8-rc1 нет существующего эквивалента»).
Введение третьего поля означало бы дублирующий слой маппинга поверх рабочего
плюс миграцию существующих conversations.

Реализовано (6 коммитов): метаданные `effortSelector`, общий resolver, inline-UI,
i18n, тесты и очистка OpenAI-флага `useResponsesApi` перед Bedrock-запросом.

## Отклонение, требующее вашего решения

§16.5 ждёт `Claude/high -> GPT/high`. Так как значение хранится в нативных полях,
а у Claude и GPT это **разные** параметры, перенос сделан в resolver'е: если поле
новой модели пусто, берётся значение sibling-поля, когда оно входит в options
новой модели. Проверено тестами:

    Claude/high -> GPT        reasoning_effort=high
    Claude/max  -> GPT        reasoning_effort=medium   (max ∉ GPT options)
    GPT/xhigh   -> Qwen       селектор скрыт
    Qwen        -> GPT        reasoning_effort=xhigh    (восстановление)
    GPT/xhigh   -> Claude     effort=medium
    GPT/high    -> GLM        reasoning_effort=high
    Qwen        -> Kimi       reasoning_effort=medium

Оба поля одновременно провайдеру не уходят: пишется только `effortSelector.field`,
второе поле остаётся нетронутым в разговоре и вырезается адаптером bedrock.

Для custom endpoint `useResponsesApi` задаётся через `addParams.useResponsesApi`.
Одноимённое поле непосредственно на endpoint схема конфига удаляет.

## Применение

Форк (разработка):

    git checkout -b feat/inline-thinking-effort v0.8.8-rc1
    git am patches/*.patch

LXC (tarball-инсталляция helper-скрипта, без .git):

    mkdir -p /opt/patches && cp patches/*.patch /opt/patches/
    cd /opt/librechat
    for p in /opt/patches/*.patch; do patch -p1 --forward --dry-run -s < "$p" || echo "FAIL $p"; done
    for p in /opt/patches/*.patch; do patch -p1 --forward < "$p"; done
    cp librechat.yaml /opt/librechat-data/librechat.yaml   # если ещё не вынесен
    NODE_OPTIONS=--max-old-space-size=4096 npm run frontend
    systemctl restart librechat

Серия проверена `patch -p1 --dry-run` на чистом дереве v0.8.8-rc1 — применяется без конфликтов.

## Что осталось проверить у себя

1. `npm run lint` и typecheck — прогнать в форке (в контейнере нет dev-зависимостей для eslint).
2. Component-тесты §16.3 — не написаны; resolver и config-схема покрыты 28 тестами
   (`packages/data-provider/specs/effort.spec.ts`, все проходят).
3. Smoke §17 — вручную по чеклисту.
4. `tokenLimit` и `pricing` в modelSpecs не входят в `tModelSpecSchema` и молча
   срезаются zod'ом; в новом YAML они убраны. Лимиты живут в
   `preset.maxContextTokens` / `preset.maxOutputTokens`.
5. i18n-ключи названы по конвенции LibreChat (`com_ui_thinking_effort*`), а не
   `thinking_effort*` из §11 — иначе не проходит типизация `TranslationKeys`.
