# BTWeb

Reusable ESP32 BLE control library and a Bluefy web controller, with an onboard RGB LED example for the TENSTAR ESP32-C3 SuperMini Plus. GPIO8 was confirmed by the owner. This is version 0.1.0: a proof of concept with a reusable API, bounded command processing and explicit hardware assumptions.

## What runs where

The ESP32 hosts a **BLE GATT service**, not an HTTP website over Bluetooth. Bluefy loads the controller from HTTPS, then sends commands directly over BLE. The firmware needs neither internet access nor a Wi-Fi access point.

The controller silently caches its files where service workers are supported. Bluefy may also retain the page through its own browser cache; lack of service-worker support does not prove offline reopening will fail. Load it before travelling and perform the offline test below. **A fresh or cleared browser cannot fetch this page from the board over Bluetooth.** If first use must work with no previously loaded page, this architecture does not meet that requirement: use an installed native BLE controller, or a Wi-Fi-hosted controller instead.

Bluefy's developer specifies HTTPS for Web Bluetooth: [Bluefy on the App Store](https://apps.apple.com/us/app/bluefy-web-ble-browser/id1492822055). Offline caching support on the user's iPhone still requires physical testing.

## Build and upload on Windows

Open this folder in VS Code with PlatformIO installed. Use the wrapper below to keep PlatformIO packages, cache and temporary build files inside `BTWeb`. It uses an existing PlatformIO executable without changing its installation. The process-only execution-policy argument does not change the machine's PowerShell policy.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\pio.ps1 run
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\pio.ps1 device list
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\pio.ps1 run --target upload --upload-port COM7
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\pio.ps1 device monitor --port COM7
```

Replace `COM7` with the actual device port. Nothing automatically flashes a connected board. Connect with a USB data cable. If initial upload cannot connect, hold BOOT, press and release RESET, release BOOT, then retry; the USB port may change. Reset after upload if it remains in download mode. Close serial monitors before uploading. The sketch never waits for the serial monitor.

`platformio.ini` selects a generic ESP32-C3 build target with 4 MB flash and native USB CDC; it does not imply this is an Espressif DevKitM board. DIO flash mode is explicitly selected. See [hardware details](docs/HARDWARE.md) before changing the target. Pinned stack: PlatformIO Espressif32 6.13.0, Arduino-ESP32 2.0.17 / ESP-IDF 4.4.7, NimBLE-Arduino 2.3.6. The LED uses the bundled asynchronous RMT driver API. This is the Arduino stack supplied by the official PlatformIO platform, not the latest Espressif Arduino release.

## Publish the controller to GitHub Pages

1. The project repository is [SeanDolan/BTWeb](https://github.com/SeanDolan/BTWeb). Push changes to `main`; ignored build/tool folders must stay excluded.
2. In repository **Settings → Pages**, choose **Deploy from a branch**, your main branch, and `/docs`.
3. Open `https://seandolan.github.io/BTWeb/controller.html` in **Bluefy** on your iPhone. The footer says **Controller 9**. This address and its new script paths bypass earlier controller assets retained by the browser; saved devices remain on the same origin.
4. Enable Bluetooth and grant Bluefy Bluetooth permission. Tap **Add board** and choose `MNQ-BT-0001` in the browser's device picker. Repeat to add more boards. No prior pairing in iPhone Settings is required.
5. Each device has a table row: **Device | Red | Blue | Green | blank**. Tap a colour once to set that board's LED, or the blank button to turn it off. The selection reflects the state acknowledged by that board.

The page stores multiple device IDs and names locally. On opening the page or returning it to the foreground, it uses `navigator.bluetooth.getDevices()` to find exact ID matches for its saved boards and attempts their connections independently. Other browser permission records are ignored; only Add board or an explicit reselection adds a device. Names are labels; browser device IDs distinguish boards even when names match. Each board still accepts one phone connection, while the page can manage several boards.

**Disconnect** stops automatic reconnection for that row, including after reopening; tap its **Connect** button to enable it again. An unavailable board times out after 12 seconds without blocking other rows. There is no continuous background scanning or retry loop. If Bluefy cannot return a previously authorised device, use **Connect** or **Add board** to select it again. Persistent storage and device permissions depend on the browser; live control still works if local storage is unavailable.

All web assets are local to the repository; there are no CDNs, analytics or runtime package downloads. Relative URLs support arbitrary repository names. `docs/.nojekyll` allows direct static hosting. CI builds and tests the project; publishing is controlled by your Pages settings.

## Remote/offline acceptance test

Connect always retries the saved device ID; it never opens a picker. Failed references are discarded and retrieved again by exact ID on manual retry. Only Add board opens the picker. For restored devices, the controller waits up to eight seconds for an advertisement when watchAdvertisements is supported, then connects. Enable Allow BLE advertisements in Bluefy for this path. Browsers without this API attempt a direct connection. Remove deletes unwanted saved rows without clearing other boards.

1. Load the Pages URL fully in Bluefy while online. Bookmark that exact URL in Bluefy. Caching runs silently where supported; the page displays no offline-readiness claim.
2. Turn off Wi-Fi and mobile data, or enable airplane mode and re-enable Bluetooth.
3. Close and reopen Bluefy, open the bookmark, connect, and change all three colours.
4. Repeat after restarting the iPhone and ESP32. Keep Bluefy in the foreground during use.

If reopening fails, offline Bluefy use is not validated. Do not clear browser storage or use private browsing for the cached controller. iOS/browser storage eviction can remove downloaded assets. A home-screen shortcut may open Safari rather than Bluefy; use the Bluefy bookmark. Firmware is independent of this cache, but the phone still needs its controller code.

## LED behaviour

| State | LED |
| --- | --- |
| Initialisation / startup failure | Dim red |
| Advertising, waiting for connection | Blue blink every 500 ms |
| New BLE connection | Dim green |
| User command while connected | Red, green, blue or off until another command or disconnect |

Brightness is capped at 24/255 in `include/BoardConfig.h`. Protocol RGB values are logical values before that cap; a reported colour confirms application acceptance into the LED output slot, not optically measured light. Power-on LED state before the sketch starts is controlled by the board/boot ROM.

## Reuse in another project

Copy `lib/BTWeb` into the other project's `lib/` directory and include `BTWeb.h`. Keep one persistent instance, call `begin()` once in `setup()`, and call `poll()` frequently in `loop()`. The application supplies the output handler; the library has no GPIO, LED, Wi-Fi or ESP-NOW dependencies.

```cpp
#include <BTWeb.h>
BTWeb control;
bool setOutput(btweb::Color colour, void* context) {
    // Update your verified hardware, or enqueue bounded application work.
    // Return true only if your application accepted the change.
    return true;
}
void setup() { control.begin("MyProject", setOutput); }
void loop() { control.poll(); yield(); }
```

Copy `include/RgbLed.h` and the example integration if the new project also uses a WS2812-compatible pixel. This driver reserves RMT TX channel 0 and uses the IDF 4.4 API; revisit the driver when changing SDK major versions. More detail: [API and execution model](docs/ARCHITECTURE.md), [wire protocol](docs/PROTOCOL.md), [ESP-NOW integration](docs/ESPNOW.md), [validation checklist](docs/TESTING.md).

## Scope and release status

One BLE client, unauthenticated local LED control, no persistent colour storage, no OTA, and no ESP-NOW network implemented in this example. Anyone nearby with a compatible BLE client can control the LED. Before adapting it to an actuator or shipping a product, define authenticated ownership/pairing, disconnect behaviour, radio-load requirements and recovery behaviour. The provided version is not a certified or hardware-qualified commercial product.

No open-source licence has been selected on the owner's behalf. Dependencies retain their respective licences. Before distributing BTWeb as a reusable public library, add your chosen licence and update `library.json` metadata. See [contribution notes](CONTRIBUTING.md).
