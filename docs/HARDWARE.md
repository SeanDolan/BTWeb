# Hardware and pin confirmation

Target listing: [AliExpress item 1005007685790119](https://www.aliexpress.com/item/1005007685790119.html), identified by its listing title as TENSTAR ESP32-C3 SuperMini Plus / red V2.0 board. The automated browser could not retrieve the listing or its pinout images. Those images have **not** been independently inspected.

On 2026-09-09 the owner explicitly confirmed: **“gpio08 is the rgb led pin”**. This confirmation is the source for the sole application GPIO assignment. `include/BoardConfig.h` records GPIO8 explicitly; it never uses a potentially mismatched board definition's `LED_BUILTIN` or `RGB_BUILTIN` macro.

| Resource | Assignment | Evidence / restriction |
| --- | --- | --- |
| Onboard RGB data | GPIO8 | Owner confirmation above; reserved exclusively for the LED |
| RMT TX | Channel 0, one memory block | Reserved exclusively for asynchronous RGB output; no other RMT library may claim this channel |
| USB D− / D+ | GPIO18 / GPIO19 | ESP32-C3 fixed native USB signals; reserved for upload and USB CDC |
| GPIO2, GPIO8, GPIO9 | Boot-strapping pins | Chip datasheet; no new external circuitry or runtime use except the confirmed onboard LED on GPIO8 |
| GPIO12–17 | Flash-related signals | Reserved conservatively; not assigned by this example |
| All other header GPIOs | Unassigned | No inferred I2C/SPI/UART defaults enabled |

The chip-level USB and strapping assignments are confirmed in [Espressif's ESP32-C3 datasheet](https://documentation.espressif.com/ESP32-C3_Datasheet_en.pdf), sections “Pin Overview” and “Boot Configurations”. Pin multiplexing capabilities are not an instruction to use the same pin for multiple peripherals.

**GPIO8 is not conflict-free in every possible project.** It also participates in boot strapping. This sketch drives the existing LED only after startup and does not change the board's reset-time circuitry. Do not connect another driver or pull-down to GPIO8. Keep GPIO9/BOOT free from circuitry that could force download mode. Native USB excludes reuse of GPIO18/19 while uploading or monitoring.

The LED driver expects one WS2812-compatible, 800 kHz, GRB-order addressable LED. The user confirmed the data pin; the LED part number and order have not been independently confirmed from the inaccessible seller images. Red/green/blue visual testing is required. If red and green are swapped, confirm the installed LED's byte order before changing the `grb` byte order in `include/RgbLed.h`; do not move the GPIO by trial and error.

The PlatformIO profile assumes ESP32-C3, 4 MB flash, 160 MHz CPU and native USB, with conservative DIO flash mode. Check the board markings and the uploader's reported chip/flash size on first upload. No external wiring is needed. No UART, I2C, SPI, secondary LED, button input or Wi-Fi service is initialised by the example.

Verified at source level: the application assigns GPIO8 only, USB uses its fixed pins, and the BLE library assigns none. Physical board revision, LED colour order and reset/upload behaviour remain hardware acceptance checks, not claims established by compilation.
