# Validation

Run the dependency-free browser tests with Node.js 22 or newer:

```powershell
node --test tests/*.test.js
```

Build the actual firmware with the project-local PlatformIO wrapper described in the README. GitHub Actions repeats compilation and browser tests on pushes and pull requests. Compilation cannot verify pins, optical colour, RF reliability or Bluefy's offline browser behaviour.

## Physical acceptance checklist

- Add two boards, confirm separate rows, and change red, blue, green and off independently.
- Reopen the page and return from another app: previously authorised boards should connect without a picker where Bluefy provides their permissions.
- Turn one board off; its timeout must not block the other board's controls.
- Use a row's Disconnect button, reopen the page, and verify it stays disconnected until Connect is tapped.
- Give two boards the same advertised name and confirm commands still target the selected row.

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

Record iPhone model, iOS version, Bluefy version, board markings, flash capacity and observed RGB order with the results. Multiple physical boards in Bluefy have not been tested by the coding agent.

## Multi-device controller checks (2026-09-16)

- Restoration tests now use explicitly saved device IDs. Unknown permission records and same-name/different-ID devices are ignored. Failed references are discarded; manual Connect refreshes the saved ID without a picker. Tests cover changed-ID replacement, cancelled/failed selection, and string/object errors with connection-stage reporting.

- Protocol, device registry, page interaction and cache tests: 35 passed using simulated Bluetooth devices and a minimal DOM.
- The fresh controller.html entry and controller/ module paths avoid old cached script URLs. Its footer shows the loaded commit; both HTML entry points are checked for consistency.
- Stale-entry removal persists across reload without removing other boards; explicitly selecting a removed device restores it. Returning from the picker preserves the freshly selected device reference.
- Added regression checks for stale restored names, saving the name after connection, and visible device-restoration errors.
- Verified independent colour/off routing, duplicate names, permission restoration without a picker, manual disconnect persistence, unavailable storage, isolated timeouts, and late connection completion after a retry.
- The page interaction check verifies five cells per board and a single off-button click targeting only that board. It does not verify iPhone rendering or Bluefy's actual permission persistence.
- Firmware is unchanged for this controller update; physical multi-board acceptance remains to be performed in Bluefy.

## Recorded local results (2026-09-09)

- PlatformIO `esp32c3` release build: PASS with the asynchronous RMT LED driver.
- Static RAM: 23,780 / 327,680 bytes (7.3%). This excludes runtime BLE heap use.
- Application flash: 485,962 / 1,310,720 bytes (37.1%).
- Browser/protocol/offline-cache tests: 10 passed; JavaScript syntax checks passed.
- No flashing, real BLE connection, optical LED test or iPhone offline test performed.

The existing PlatformIO core/toolchain was read and copied into the project-local tool cache. The registry Python client failed to download NimBLE, so the exact upstream 2.3.6 tag archive was downloaded with curl and registered in the ignored local dependency cache. Compilation used that unmodified source release. A missing `intelhex==2.3.0` esptool dependency was installed into `.tools/python-deps`; the wrapper reads it through PYTHONPATH. Fresh installations use the pinned registry dependency in `platformio.ini` normally. Build output, downloads, tools and temporary files are ignored by Git.

Advertisement reconnection tests verify that GATT connection follows a matching advertisement, unrelated IDs are ignored, and denial, cancellation and timeout stop watching. This follows the Google Web Bluetooth Watch Advertisements and Connect sample; actual Bluefy restart behaviour remains a physical acceptance check.

Reload tests verify network-only release lookup, full asset download, rejection of invalid paths, and staying on the working page if offline. The deployed commit is embedded in each immutable release during the Pages build.

## Wi-Fi scan validation

- Firmware builds successfully: 43,988 bytes static RAM; 898,974 bytes application flash.
- 40 browser tests pass, including SSID/security/RSSI decoding, selected-board routing, Clear during result delivery, old firmware, and inclusion of scan scripts in offline assets.
- Physical acceptance: scan while changing red/blue/green/off; verify BLE stays connected, hidden/duplicate SSIDs remain separate, Clear prevents late rows, and disconnect/reconnect does not expose a previous session's pending results.
Live COM9 validation: uploaded successfully to ESP32-C3; scan found 9 APs, BLE stayed connected, and 6 LED colour commands were acknowledged during the scan. All 9 result rows were read; the largest response was 24 bytes, exercising long reads beyond the default 20-byte ATT payload. Combined scan/read test took 5.81 seconds. Test used Windows Bleak; Bluefy page rendering and optical LED colours still require the user's check. Nearby SSIDs were not recorded in the test output.