# Настройка PipeWire для захвата звука Firefox

Инструкция рассчитана на Bazzite, PipeWire и официальный Firefox Flatpak `org.mozilla.firefox`.

## 1. Проверка окружения

```bash
systemctl --user is-active pipewire pipewire-pulse wireplumber
flatpak list --app --columns=application,name | grep -i firefox
flatpak info --show-permissions org.mozilla.firefox | grep -i pulseaudio
pactl get-default-sink
```

Все три аудиосервиса должны быть активны. Default sink должен быть физическими наушниками или колонками.

## 2. Создание виртуального выхода и источника

```bash
mkdir -p "$HOME/.config/pipewire/pipewire-pulse.conf.d"

cat > "$HOME/.config/pipewire/pipewire-pulse.conf.d/90-librechat-browser-audio.conf" <<'EOF'
pulse.cmd = [
  {
    cmd = "load-module"
    args = "module-null-sink sink_name=librechat_browser_audio sink_properties=device.description=LibreChat_Browser_Audio"
    flags = [ ]
  }
  {
    cmd = "load-module"
    args = "module-remap-source master=librechat_browser_audio.monitor source_name=librechat_browser_capture source_properties=device.description=LibreChat_Browser_Capture"
    flags = [ ]
  }
  {
    cmd = "load-module"
    args = "module-loopback source=librechat_browser_audio.monitor latency_msec=30"
    flags = [ ]
  }
]
EOF

systemctl --user restart pipewire-pulse.service
```

Проверка:

```bash
pactl list short sinks | grep librechat_browser_audio
pactl list short sources | grep librechat_browser_capture
```

Если виртуальный sink стал системным по умолчанию, выберите физический выход в настройках звука и снова перезапустите `pipewire-pulse`.

## 3. Маршрутизация всего Firefox

```bash
flatpak override --user \
  --socket=pulseaudio \
  --env=PULSE_SINK=librechat_browser_audio \
  org.mozilla.firefox
```

Полностью закройте и заново запустите Firefox. Теперь весь его звук должен проходить через виртуальный sink и одновременно воспроизводиться на default-выходе.

## 4. Проверка записи

Запустите видео в Firefox, затем:

```bash
parecord --device=librechat_browser_capture \
  "$HOME/librechat-browser-audio-test.wav"
```

Через несколько секунд остановите запись через `Ctrl+C` и прослушайте:

```bash
paplay "$HOME/librechat-browser-audio-test.wav"
```

В Firefox при первом запросе микрофона выберите `LibreChat_Browser_Capture` и сохраните разрешение для HTTPS-домена LibreChat.

Проверьте также переключение между колонками и наушниками. Loopback должен следовать за default-выходом. Если он остаётся на старом устройстве, временное восстановление:

```bash
systemctl --user restart pipewire-pulse.service
```

## Откат

```bash
flatpak override --user --unset-env=PULSE_SINK org.mozilla.firefox
rm -f "$HOME/.config/pipewire/pipewire-pulse.conf.d/90-librechat-browser-audio.conf"
systemctl --user restart pipewire-pulse.service
rm -f "$HOME/librechat-browser-audio-test.wav"
```

После отката полностью перезапустите Firefox.
