# Validation

Run the dependency-free browser tests with Node.js 22 or newer:

```powershell
node --test tests/ble.test.js tests/offline.test.js
```

Build the actual firmware with the project-local PlatformIO wrapper described in the README. GitHub Actions repeats compilation and browser tests on pushes and pull requests. Compilation cannot verify pins, optical colour, RF reliability or Bluefy's offline browser behaviour.

## Physical acceptance checklist

- Confirm uploader detects ESP32-C3 and 4 MB flash; verify board variant and USB connection.
- Boot without a serial monitor: dim red during startup, blue blink while advertising.
- Connect with Bluefy: green status, then individually confirm Red, Green, Blue and Off match the actual LED.
- Disconnect and reconnect repeatedly; reset the ESP32 while connected; cancel the browser picker.
- Deny Bluetooth permission and verify the page recovers after permission is granted.
- Confirm app failure/timeout never displays “Colour confirmed by board”.
- With a BLE test client, send invalid version, operation, length and nonzero status payload; confirm no unwanted LED update.
- Flood more than eight commands before loop processing; check drop reporting and later responsiveness.
- Disconnect with queued traffic; confirm old-session queued commands are discarded after reconnect.
- Perform the full no-internet / cold-browser test in README; test again after an iPhone restart.
- Measure main-loop latency and Bluetooth control under the intended future ESP-NOW load before claiming network readiness.

Record iPhone model, iOS version, Bluefy version, board markings, flash capacity and observed RGB order with the results. No physical ESP32 or iPhone has been tested by the coding agent.

## Recorded local results (2026-09-09)

- PlatformIO `esp32c3` release build: PASS with the asynchronous RMT LED driver.
- Static RAM: 23,780 / 327,680 bytes (7.3%). This excludes runtime BLE heap use.
- Application flash: 485,962 / 1,310,720 bytes (37.1%).
- Browser/protocol/offline-cache tests: 10 passed; JavaScript syntax checks passed.
- No flashing, real BLE connection, optical LED test or iPhone offline test performed.

The existing PlatformIO core/toolchain was read and copied into the project-local tool cache. The registry Python client failed to download NimBLE, so the exact upstream 2.3.6 tag archive was downloaded with curl and registered in the ignored local dependency cache. Compilation used that unmodified source release. A missing `intelhex==2.3.0` esptool dependency was installed into `.tools/python-deps`; the wrapper reads it through PYTHONPATH. Fresh installations use the pinned registry dependency in `platformio.ini` normally. Build output, downloads, tools and temporary files are ignored by Git.