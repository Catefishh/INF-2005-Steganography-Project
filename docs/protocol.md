# Stegloc Version 1 Protocol

This document freezes the Stegloc v1 binary and cryptographic protocol. All
multi-byte integers are unsigned and big-endian. Lengths count bytes, not
characters. A parser must reject unsupported versions, nonzero flags,
noncanonical encodings, trailing bytes, and declared lengths outside the bounds
below before slicing or interpreting the declared section.

## Identifiers and Limits

| Name | v1 value |
| --- | --- |
| Protocol identifier | `stegloc-v1` |
| Hash algorithm | SHA-256, named `sha256` |
| Signature algorithm | Ed25519, named `ed25519` |
| Authenticated encryption | AES-256-GCM |
| Signed record maximum | 16,384 bytes |
| Locator maximum | 4,096 bytes |
| Raw content maximum | 104,857,600 bytes (100 MiB) |
| Signed package maximum | 104,874,066 bytes |
| Encrypted payload envelope maximum | 104,874,094 bytes |
| Ed25519 signature | exactly 64 raw bytes |
| AES-GCM nonce | exactly 12 random bytes |
| AES-GCM tag | exactly 16 bytes, appended by AES-GCM |
| HKDF salt | exactly 16 random bytes |

No custom cryptographic primitive is part of this protocol.

## Canonical JSON

Records and locators use canonical JSON with these rules:

- UTF-8 encoding with no BOM;
- object keys sorted by Unicode code point;
- compact separators: `,` and `:` with no surrounding whitespace;
- native UTF-8 characters rather than `\u` escaping where JSON does not
  require escaping;
- no NaN or infinity;
- no duplicate object keys; and
- exact schema only: unknown or missing fields are rejected.

After decoding, a parser reserializes the object and requires byte-for-byte
equality with the received bytes. Protocol schemas contain no floating-point
values.

## Signed Package

The inner package has this exact layout:

| Offset | Width | Field | v1 constraint |
| ---: | ---: | --- | --- |
| 0 | 4 | magic | ASCII `STGP` |
| 4 | 1 | version | `0x01` |
| 5 | 1 | flags | `0x00` |
| 6 | 4 | record length | `1..16384` |
| 10 | 8 | content length | `0..104857600` |
| 18 | record length | canonical record | Exact received bytes are signed |
| variable | 64 | signature | Raw Ed25519 signature |
| variable | content length | content | Raw, unmodified content bytes |

There is no alignment or trailing data. The record signature input is the
following byte concatenation:

```text
ASCII "stegloc/v1/signed-record" || 0x00 || exact_record_bytes
```

The content is bound by both `content.byte_length` and
`content.sha256` in the signed record. The signature is verified over the exact
received record bytes before any parsed record field is returned as trusted.

## Signed Record Schema

The top-level fields are exactly:

| Field | Type and v1 constraint |
| --- | --- |
| `protocol` | String, exactly `stegloc-v1` |
| `media_id` | Canonical lowercase hyphenated UUID string |
| `created_at` | Valid UTC timestamp, exactly `YYYY-MM-DDTHH:MM:SSZ` |
| `nonce` | Exactly 32 lowercase hexadecimal characters (16 bytes) |
| `team` | Object with 0..16 entries; UTF-8 keys are 1..32 bytes and UTF-8 string values are 1..128 bytes |
| `content` | Exact object described below |
| `carrier_sha256` | Exactly 64 lowercase hexadecimal characters |
| `carrier_descriptor` | Nonempty UTF-8 string, at most 512 bytes |
| `depth` | Two ASCII decimal characters, `01` through `08` |
| `start_slot` | Exactly 20 ASCII decimal characters encoding a uint64 |
| `encoded_byte_length` | Exactly 20 ASCII decimal characters encoding a uint64 |
| `hash_algorithm` | String, exactly `sha256` |
| `signature_algorithm` | String, exactly `ed25519` |
| `signer_fingerprint` | Exactly 64 lowercase hexadecimal characters |

The `content` object fields are exactly:

| Field | Type and v1 constraint |
| --- | --- |
| `filename` | Nonempty UTF-8 string, at most 255 bytes |
| `media_type` | Nonempty ASCII string, at most 127 bytes |
| `byte_length` | JSON integer, `0..104857600`; booleans are not integers |
| `sha256` | SHA-256 of the exact raw content, as 64 lowercase hexadecimal characters |

The signer fingerprint is SHA-256 over the exact 32-byte Ed25519 raw public-key
encoding, rendered as lowercase hexadecimal.

### Fixed-Width Substitution

The carrier hash placeholder is 64 ASCII zeroes. The start-slot and
encoded-length placeholders are each 20 ASCII zeroes. Depth always occupies two
ASCII characters. Final values must use the same widths. Consequently replacing
the placeholder carrier hash, depth, start slot, or encoded byte length cannot
change canonical record length, signed-package length, encrypted-envelope
length, or occupied carrier slots.

Only ASCII `0` through `9` are decimal digits. Unicode numeral characters are
rejected even when Python could otherwise interpret them as decimal values.

For canonical carrier hashing, the workflow substitutes the carrier hash
placeholder before calculating the digest and writes the final lowercase digest
back into the same-width field. The image adapter uses these concrete domains:
`stegloc/v1/carrier/bmp-exact\0` followed by the complete original BMP bytes,
with occupied RGB low-k bits masked, and
`stegloc/v1/carrier/<descriptor>\0` followed by decoded row-major channel
 bytes for PNG. RGBA PNG includes each decoded alpha byte in pixel order; RGB
 PNG has no alpha bytes. PNG alpha bytes are preserved and authenticated, and
PNG compression, ancillary chunks, and other encoding metadata are excluded.
BMP headers, pixel row padding, orientation, and all other bytes remain part of
the exact-size canonical input. The adapter supports only nonanimated 8-bit
RGB/RGBA PNG and uncompressed 24-bit BI_RGB BMP.

For record byte length `R` and raw content byte length `C`, the signed-package
length is `18 + R + 64 + C`. The complete encrypted payload envelope is a
12-byte nonce followed by package ciphertext and its 16-byte tag, so its length
is `R + C + 110`. `encoded_byte_length` records this complete encrypted payload
envelope length. The 100 MiB raw-content cap keeps the complete one-shot
AES-256-GCM operation within a truthful local-memory baseline. Larger content,
including a future video milestone, requires a separately designed streaming
protocol rather than increasing this v1 limit.

## Payload Encryption

A random 12-byte nonce is generated for every encryption, including repeated
encryption of identical plaintext. The outer embedded bytes are:

```text
nonce (12 bytes) || AES-256-GCM ciphertext || tag (16 bytes)
```

The payload key is the HKDF-derived payload key. The exact associated data is:

```text
ASCII "stegloc/v1/aes-256-gcm/payload" || 0x00
```

## Recovery Material and Key Separation

A recovery secret is 32 bytes from the operating-system cryptographic random
source. Its copyable code is uppercase prefix `STEGLOC1-` followed by eight
groups of eight lowercase hexadecimal characters separated by hyphens:

```text
STEGLOC1-00010203-04050607-08090a0b-0c0d0e0f-10111213-14151617-18191a1b-1c1d1e1f
```

Decoding is strict: case, prefix, separators, group count, characters, and total
length must match exactly. The sidecar contains an independent random 16-byte
salt. Three independent HKDF-SHA256 invocations derive 32 bytes each from the
same recovery secret and salt with these exact `info` values:

```text
stegloc/v1/hkdf/payload-key\x00
stegloc/v1/hkdf/locator-key\x00
stegloc/v1/hkdf/start-selection-key\x00
```

These keys are not interchangeable. The start-selection key is reserved for a
later placement workflow; Task 2 performs no start selection.

## Locator

The canonical locator object has exactly these fields:

| Field | Type and v1 constraint |
| --- | --- |
| `protocol` | String, exactly `stegloc-v1` |
| `carrier_descriptor` | Same nonempty UTF-8 descriptor and 512-byte limit as the record |
| `depth` | Same fixed-width `01` through `08` value as the record |
| `start_slot` | Same fixed-width uint64 decimal value as the record |
| `encoded_byte_length` | Same fixed-width uint64 decimal value as the record |
| `media_id` | Same canonical UUID as the record |
| `encrypted_package_sha256` | SHA-256 of the complete nonce-plus-ciphertext payload envelope, as 64 lowercase hexadecimal characters |

The locator signature input is distinct from the record domain:

```text
ASCII "stegloc/v1/signed-locator" || 0x00 || exact_locator_bytes
```

The plaintext encrypted into the sidecar is `exact_locator_bytes || signature`.
Because the Ed25519 signature is exactly 64 bytes, the final 64 plaintext bytes
are the signature and all preceding plaintext bytes are the bounded locator.

## Sidecar

The `.stegloc` sidecar has this exact layout:

| Offset | Width | Field | v1 constraint |
| ---: | ---: | --- | --- |
| 0 | 4 | magic | ASCII `STGL` |
| 4 | 1 | version | `0x01` |
| 5 | 16 | salt | HKDF salt |
| 21 | 12 | nonce | Fresh locator AES-GCM nonce |
| 33 | remaining bytes | encrypted signed locator | `81..4176` bytes, including the 16-byte GCM tag |

The complete 33-byte clear header, including magic, version, salt, and nonce, is
the locator AES-256-GCM associated data. Every remaining byte is ciphertext or
tag; there is no encoded ciphertext-length field and no trailing-data concept.
The complete sidecar is therefore `114..4209` bytes. A parser checks the fixed
header and total sidecar bounds before decryption, then checks the decrypted
locator bound before signature verification or JSON interpretation.

## Bitstream Mapping

Carrier mutation is not part of Task 2, but all future implementations use this
frozen mapping. The encrypted payload envelope is a byte stream whose bits are
consumed most significant bit first (`bit 7` through `bit 0`). For each eligible
carrier slot, up to `depth` stream bits are written in least-significant-bit
order: the first stream bit goes to carrier bit 0, the next to bit 1, and so on.
Extraction reads carrier bits 0 through `depth - 1` in that order and reconstructs
each stream byte at bit 7 through bit 0. If the envelope ends partway through a
slot, every unused selected low-bit position in that final slot is set to zero.
Extraction rejects nonzero padding. There is no wraparound. Canonical masking
clears all `k` low bits of exactly the occupied slots, including the final
partially used slot; it preserves higher bits and all unrelated slots.

For `N` eligible slots, zero-based start slot `s`, depth `k`, and envelope byte
length `E`:

```text
available = floor((N - s) * k / 8)
required  = ceil(E * 8 / k)
fits      iff 0 <= s < N and s + required <= N
```

Capacity checks occur before mutation. Partial embedding is forbidden.
The shared LSB operations also accept empty bytes as a no-op: for `E = 0`,
`0 <= s <= N` is valid, including an empty carrier at start zero. The formula
above describes nonempty envelopes, which callers validate. Shared byte lengths,
slot counts, and starts are nonnegative uint64 integers; booleans are invalid.

## Verification Order and Errors

High-level recovery takes the encrypted payload bytes, sidecar, recovery code,
and a caller-selected Ed25519 public key. It establishes trust in this order:

1. Strictly parse the bounded clear sidecar header and recovery code.
2. Derive separated keys and authenticate/decrypt the locator ciphertext.
3. Verify the locator signature over the exact received locator bytes with the
   caller-selected public key, then parse the canonical locator.
4. Compare the signed locator's encrypted-package SHA-256 with the exact supplied
   encrypted payload bytes.
5. Authenticate/decrypt the payload envelope.
6. Split the bounded signed package, verify its signature over the exact received
   record bytes, and only then parse and return record fields as trusted.
7. Verify signer fingerprint, content byte length, and content SHA-256.
8. Require locator and record protocol, media ID, carrier descriptor, depth,
   start slot, and encoded byte length to agree, and require the signed encoded
   length to equal the actual encrypted payload length.

A wrong but well-formed recovery code and altered locator ciphertext both fail
with the same ambiguous recovery error. No signature verdict is emitted when
locator AEAD authentication failed. A locator signature failure is meaningful
only after successful locator decryption and is reported separately. Digest,
payload-authentication, record-signature, and cross-structure consistency errors
remain distinct.

## WAV Carrier Mapping

RIFF/WAVE carriers use the exact `RIFF` file bytes as the canonical input. The
adapter accepts only little-endian PCM integer (`wFormatTag = 1`) with one or
two channels and 8, 16, 24, or 32 bits per sample. It validates the RIFF
declared size, every chunk's bounded size and one-byte word padding, the 16-byte
`fmt ` fields, and that `byte_rate`, `block_align`, and the `data` length agree.
RF64, extensible format, float, compressed, truncated, oversized, and
inconsistent files are rejected.

There is one logical slot for each sample value, in interleaved order:
`slot = sample_frame * channels + channel`. A slot is the least-significant
byte of that little-endian sample. Depth `k` replaces bits 0 through `k-1` of
that byte, for `k` from 1 through 8; all higher sample bytes, signed raw value
representation, chunk bytes, chunk order, padding, and file length are kept
unchanged. Audio is never decoded, normalized, resampled, clipped, or
reconstructed during export.

The WAV carrier hash domain is
`stegloc/v1/carrier/wav-exact\0` followed by the complete original file bytes,
with the low `k` bits masked only in the occupied sample-slot bytes. Headers,
ancillary chunks, data padding, and unoccupied sample bytes remain hashed.

## Carrier Scope

Later workflows are restricted to nonanimated 8-bit RGB/RGBA PNG, uncompressed
24-bit `BI_RGB` BMP, and RIFF integer PCM WAV (8/16/24/32-bit, mono or stereo).
Restricted uncompressed AVI remains gated until image and audio support is
complete. This task deliberately provides no carrier hashing, media adapters,
LSB operations, workflows, or HTTP endpoints.
