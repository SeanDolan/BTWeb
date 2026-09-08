# ESP-NOW integration boundary

This example intentionally does not initialise Wi-Fi or ESP-NOW, register peers, or send packets. BTWeb has no ownership of a Wi-Fi channel, callbacks or GPIOs, making later application integration possible without rewriting its BLE transport.

Do not infer simultaneous ESP-NOW/BLE reception guarantees from this LED demo. The ESP32-C3 shares one 2.4 GHz radio between BLE and Wi-Fi. Support and scheduling conditions depend on the actual SDK, not just the chip name.

- [Espressif's IDF 5.0 C3 coexistence table](https://docs.espressif.com/projects/esp-idf/en/v5.0/esp32c3/api-guides/coexist.html) marks ESP-NOW TX with BLE as supported and RX as unsupported.
- [The current C3 table](https://docs.espressif.com/projects/esp-idf/en/stable/esp32c3/api-guides/coexist.html) marks RX as supported in STA mode, otherwise unsupported. It also describes the shared-radio scheduling constraints.
- This build uses the official PlatformIO Arduino 2.0.17 package with **IDF 4.4.7**. The newer table is not evidence for this older compiled stack. Its packaged C3 SDK enables `CONFIG_ESP32_WIFI_SW_COEXIST_ENABLE` and `CONFIG_SW_COEXIST_ENABLE`, but enabling coexistence alone is not a reception guarantee.

Before making this a network gateway, choose and pin an SDK with documented support for the required scenario, then validate on hardware. Migration to a recent Espressif SDK / Arduino core is a separate integration step; changing a `-D` flag cannot replace precompiled radio libraries.

## Application design for a later network

1. Own Wi-Fi in your application, use the required STA mode, and initialise it before ESP-NOW. Keep nodes on the same explicit legal Wi-Fi channel. Avoid scans/reconnections that change channel during operation.
2. Validate length/version/source in receive callbacks and copy packets into a bounded queue. Do not call LED output or `BTWeb::setColor` from Wi-Fi callbacks; process from `loop()`.
3. Use node IDs, sequence numbers, delivery acknowledgements, bounded retries and duplicate handling. BLE command acceptance is not proof that a remote ESP-NOW node applied it.
4. Limit network traffic and measure p95/p99 command latency, packet loss, queue drops and disconnects with BLE advertising and with an active iPhone connection.
5. Repeat testing with the phone backgrounded, at weak signal, and after power loss. Decide explicitly whether commands persist, expire or enter a safe state.

An ESP-NOW peer network does not automatically provide mesh routing. Discovery, forwarding, loop prevention and peer security must be designed separately. [Espressif's ESP-NOW API documentation](https://docs.espressif.com/projects/esp-idf/en/v5.4.1/esp32c3/api-reference/network/esp_now.html) explains the callback and channel model.
