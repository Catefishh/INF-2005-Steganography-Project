# Stegloc embedding format (`stegloc/2`)

This is the exact format implemented in `backend/app/stego/engine.py`. All integers are unsigned big-endian.

## Slots

| Cover | Slot order | Slot byte |
| --- | --- | --- |
| Image | row by row, pixel by pixel, R, G, B | the channel byte (alpha is never a slot) |
| WAV | sample frame by frame, channel by channel | least significant byte of the PCM sample |

`N` = number of slots.

## Bit mapping (n LSBs, 1 ≤ n ≤ 8)

Data bytes are turned into bits MSB first (`format(byte, "08b")`). The bits are split into groups of `n`; the last group is padded with `0`. Each group replaces the lowest `n` bits of one slot:

```
slot = int(format(slot, "08b")[:-n] + group, 2)
```

So the first bit of the group becomes bit `n-1` of the slot. Example (lecture): `G = 01000111` with n = 1 changes the LSBs of 8 slots to `0,1,0,0,0,1,1,1`.

## Layout

| Region | Slots | LSBs |
| --- | --- | --- |
| Unused | 0 | - |
| Payload | `start` … `start + ceil(8·L/n) − 1` | n |
| Header | `N − 520` … `N − 1` | 1 |

Rules: `start ≥ 1` and `start + ceil(8·L/n) ≤ N − 520`.

## Header (65 bytes)

| Bytes | Field |
| ---: | --- |
| 4 | `"STG1"` |
| 16 | PBKDF2 salt (random) |
| 12 | AES-GCM nonce |
| 17 | ciphertext of `start (8) | L (8) | n (1)` |
| 16 | AES-GCM tag |

AES-GCM associated data: `"STG1" | salt`.

## Keys

```
material = PBKDF2-HMAC-SHA256(passphrase UTF-8, salt, 200000 iterations, 96 bytes)
header_key  = material[0:32]
payload_key = material[32:64]
start_key   = material[64:96]
```

Automatic start:

```
count = (N − 520) − span
start = 1 + (HMAC-SHA256(start_key, salt | descriptor UTF-8 | span as 8 bytes) as integer) mod count
```

## Payload (L bytes)

```
nonce (12) | AES-256-GCM( record_len (4) | record JSON | sig_len (2) | signature | content ) | tag (16)
```

AES-GCM associated data: `"STG1" | salt`. `L = 34 + record_len + sig_len + content_len`.

## Record

JSON with sorted keys and no spaces (`json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)`):

```json
{
  "algorithms": {"encryption": "AES-256-GCM", "hash": "SHA-256", "key_derivation": "PBKDF2-HMAC-SHA256", "signature": "RSA-PSS (SHA-256)"},
  "cover": {"descriptor": "image:640x480:RGB", "filename": "cover.png", "sha256": "<64 hex>", "type": "image"},
  "embedding": {"header_slot": "<20 digits>", "lsb_bits": 1, "method": "LSB replacement", "start_slot": "<20 digits>"},
  "media_id": "<uuid4>",
  "nonce": "<32 hex>",
  "payload": {"filename": "message.txt", "media_type": "text/plain", "sha256": "<64 hex>", "size": 105},
  "protocol": "stegloc/2",
  "signer_fingerprint": "<SHA-256 of DER public key>",
  "team": "P1-4",
  "timestamp": "2026-09-14T10:00:00Z"
}
```

`start_slot` and `header_slot` are zero-padded to 20 digits so the record length is known before the start is chosen.

## Hashes and signature

- `payload.sha256 = SHA-256(content)`
- `cover.sha256 = SHA-256(descriptor | cover bytes)`. The LSBs of the payload region (n bits) and the header region (1 bit) are set to 0 first. Cover bytes are the RGB bytes followed by the alpha bytes for images, and the complete WAV file for audio.
- `digest = SHA-256(record JSON bytes)`
- `signature = RSA-PSS(MGF1-SHA256, max salt length) over the prehashed digest`

## Verification order and verdicts

1. File or public key unreadable, or passphrase empty → **Cannot Verify**
2. Header magic absent → **Payload Missing**
3. Header AES-GCM fails (wrong passphrase or header changed) → **Cannot Verify**
4. Extract `L` bytes from `start` (or a manual start)
5. Payload AES-GCM fails:
   - manual start used and the real start authenticates → **Wrong Start Location**
   - otherwise → **Tampered**
6. RSA signature over `SHA-256(record)` fails → **Signature Invalid**
7. Payload SHA-256 or size differs → **Tampered**
8. Signed placement ≠ header, or cover SHA-256 differs → **Tampered**
9. Otherwise → **Authentic** (only now is the payload released)
