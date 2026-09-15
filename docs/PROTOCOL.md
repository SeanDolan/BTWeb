# BTWeb BLE protocol v1

All UUIDs are project-specific 128-bit UUIDs. Advertising includes the service UUID; the local name `MNQ-BT-0001` is provided with scan-response support. Configure one connection through the global PlatformIO build flag `CONFIG_BT_NIMBLE_MAX_CONNECTIONS=1` when reusing this library.

| Role | UUID | Properties |
| --- | --- | --- |
| Service | `fb8c0001-7b3a-4d0c-a8d5-83f46571c901` | Primary service |
| Command | `fb8c0002-7b3a-4d0c-a8d5-83f46571c901` | Write with response |
| State | `fb8c0003-7b3a-4d0c-a8d5-83f46571c901` | Read, Notify |

No pairing or encryption is required by v1. Browser permission is not device authentication. The service UUID is not a secret.

## Command: exactly 6 bytes

| Byte | Meaning |
| --- | --- |
| 0 | Version, `1` |
| 1 | Client sequence, 0–255 |
| 2 | Operation: `1` set colour, `2` request status |
| 3–5 | Red, green, blue (0–255); must all be zero for status |

Example: `[1, 7, 1, 0, 0, 255]` requests blue with sequence 7. Invalid length, version, operation or reserved values do not reach the output handler. The GATT characteristic accepts at most 20 bytes; writes over this limit are rejected by the stack before the application parser. Both valid packet types fit the default ATT MTU without fragmentation.

## State: exactly 10 bytes

| Byte | Meaning |
| --- | --- |
| 0 | Version, `1` |
| 1 | Sequence of latest processed command (initially 0) |
| 2 | Result: `0` accepted, `1` invalid, `2` queue overflow, `3` output unavailable |
| 3–5 | Last logical RGB values accepted by the application |
| 6 | Output handler configured: `0` or `1` |
| 7–8 | Low 16 bits of lifetime dropped-command count, little endian |
| 9 | Reserved, zero |

Handler availability is a capability flag, not a hardware health measurement. The drop counter wraps modulo 65536 on the wire. Overflow is asynchronous and its result uses the latest processed sequence, not necessarily the sequence of the dropped packet. A client must not interpret overflow as a successful acknowledgement.

Writes acknowledge receipt at the ATT layer; the state sequence/result acknowledges application processing. Only send the next command after the matching state. Notifications are coalesced, so a client that floods writes has no per-command response guarantee. Read state or reconnect after uncertainty. There is no automatic command replay or persistence across power loss.
