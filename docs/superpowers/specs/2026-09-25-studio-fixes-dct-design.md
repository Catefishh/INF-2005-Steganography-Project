# Studio fixes and DCT image embedding

## Approved direction

The user requested persistent stego downloads across sidebar navigation, removal of large gaps in inspection results, clickable bit-layer images, transform-domain steganography, removal of image-quality metrics from tamper tests, and separation of text work from the media working-file strip. The chosen transform is DCT with lossless PNG output.

## 1. Persistent embedding results

Keep the latest successful embedding result accessible for the current application session. Sidebar navigation back to Embed & Sign should restore the result view when it was the last active embedding view. An explicit edit action returns to the form. Store the last embedding view at the application routing boundary, rather than redirecting on every render. Deep links with no in-memory result still fall back to the form.

Keep download access to the latest successful output from the embedding form as well, until a different cover is selected, another embedding begins, or the media workspace is cleared. Preserve normal browser Back/Forward behavior. Browser reload persistence is outside this request. Check both the RSA image/audio result and the existing video result.

## 2. Inspection layout

Place RS and chi-square evidence in independently stacked responsive columns so differing card heights do not reserve an empty grid row. Move Bit layers into its own full-width section below statistical evidence. Preserve reading order and existing evidence. Single-column presentation on narrow screens must remain readable, with no fixed card heights.

## 3. Bit-layer viewer

Make each original and inspected bit-plane thumbnail an accessible button. Open a labelled enlarged dialog identifying the source, channel, and bit index. Include zoom in/out, reset, scrolling for oversized images, and pixelated image rendering. Escape and a visible close button dismiss the viewer; restore focus to the originating thumbnail. Use existing dialog primitives where available.

The viewer displays the supplied analysis image at its native resolution; if analysis subsamples the carrier, retain a visible sampling note. Do not suggest the image is a full-resolution carrier map. Changing analysis inputs closes any stale image viewer.

## 4. DCT image workflow

### User experience and boundaries

Add an embedding-method choice for images: existing spatial LSB (default), or DCT / lossless PNG. DCT accepts the currently supported image inputs after image decoding, preserves image dimensions, and produces an explicitly named PNG download. Audio and video continue to use their supported methods. DCT-specific UI shows coefficient capacity and automatic placement instead of LSB depth or pixel-start controls. It explains that lossless output prevents further codec loss, but embedding itself modifies pixels and does not guarantee recovery after resizing, JPEG recompression, or other edits.

Integrate extraction into Extract & Verify and allow downloaded PNGs to be verified independently of the sender's in-memory state. Use a versioned DCT header with a distinct identifier. The receiver detects supported DCT and LSB framing; wrong credentials or damaged data must not be presented as successful recovery. No payload or recovery parameters are stored in PNG metadata.

### Codec

Implement an isolated DCT carrier module with capacity, embed, and extract operations. Use orthonormal 8-by-8 DCTs over RGB channel blocks and a fixed, versioned selection of mid-frequency coefficient pairs. Encode each bit through coefficient ordering with a fixed minimum separation, reconstruct pixels, round and clip to the legal range, and export PNG. Complete blocks participate; incomplete edge pixels and alpha are preserved. Reserve deterministic transform slots for the bounded bootstrap header and derive payload placement from the passphrase-protected header/start mechanism.

After encoding, reopen the actual PNG bytes and recover the exact header and encrypted package. If rounding or clipping prevents recovery, retry with bounded strengthening of the affected blocks. If the bound is reached, return an actionable embedding error and publish no successful artifact. Capacity accounts for bootstrap framing, signed record, signature, encryption, and any redundancy used by the versioned codec; reject oversized inputs before modifying the carrier. Reject malformed lengths and positions before allocating or extracting.

#### Frozen first-version codec contract

Use one bit per complete 8-by-8 channel block, with spatial blocks traversed row-major and channels R, G, B within each block. Compare orthonormal DCT coefficients at (2, 3) and (3, 2), with zero-based coordinates: positive difference encodes one, negative encodes zero. Bits are most-significant-first within bytes. No error-correction or repetition is included in this version. Start with a separation of 32 coefficient units, increasing through 64, 128, and 256 only for failing blocks. After every retry, check the entire final PNG's header and package, not just changed blocks. Four unsuccessful strengths terminate with an embedding error.

Reserve the final 1,024 transform slots for a fixed 128-byte bootstrap. Its layout is a distinct four-byte method/version magic, a 16-byte salt, a 12-byte AES-GCM nonce, a 40-byte ciphertext (24-byte plaintext plus 16-byte tag), and zero padding to 128 bytes. Bootstrap plaintext holds three unsigned big-endian 64-bit integers: payload start slot, encrypted package byte length, and total transform slots. Authenticate magic and salt as associated data. Payload encryption uses a separate derived key and nonce. Placement begins at slot 1 or later and ends strictly before bootstrap slots. The header stores the placement; the passphrase-derived start key selects among structurally valid starts.

Use fixed-width decimal strings for signed slot/count fields and fixed-length hashes. Build a placeholder record first, calculate the exact encrypted package size including its nonce/tag and actual RSA signature size, choose placement, calculate coverage/hash, then serialize the final record and assert its byte length is unchanged. Reject any violation. Usable encrypted-package capacity is floor(max(0, total slots - 1,024 - 1) / 8); the payload meter subtracts the actual envelope overhead. Report capacity in bytes and occupied transform slots. Tiny images return zero capacity and an actionable error. This is structural capacity; encoding can still fail the bounded stability check.

### Encryption, signatures, and integrity scope

Reuse existing RSA-PSS, SHA-256, passphrase derivation, and AES-GCM primitives. Keep a separate versioned DCT envelope and method-specific report rather than pretending coefficients are pixel LSB slots. Sign payload metadata, payload digest, image dimensions, method/version, and placement parameters. Release extracted content only after authenticated decryption, signature verification, and payload digest verification succeed.

The existing spatial-LSB stable cover hash cannot be reused for DCT because inverse transformation changes whole blocks. For DCT, sign a canonical hash of decoded pixels outside all blocks assigned to header/payload storage, including untouched edges and alpha. Report its scope explicitly as non-embedding pixels. This detects edits outside embedding blocks; authenticated ciphertext detects corruption of the recovered payload. Do not claim that every pixel inside embedding blocks is authenticated. Verification copy must distinguish these guarantees from the existing LSB cover-integrity guarantee.

Coverage is channel-specific: exclude only the 64 channel values for each occupied channel-block slot. Hash a domain separator, dimensions, alpha-presence flag, and canonical placement ranges followed by covered RGB bytes in pixel-row-major, R/G/B order; append every alpha byte in pixel-row-major order, including alpha in occupied blocks. All unoccupied channel blocks, incomplete edges, and alpha must remain byte-identical; only reconstruct occupied channel blocks. Report protected RGB byte count and alpha coverage. Zero protected RGB values is permitted but must be labelled as no RGB cover-integrity coverage, with payload authentication still distinct.

Verification must authenticate the header, bounds-check extraction, authenticate the package, verify its signature, check payload length/digest, match signed dimensions/method/version/placement against the carrier and header, and recompute the canonical coverage hash before reporting success or releasing downloadable content. Any mismatch returns no content. Method-aware verdict copy describes partial coverage, including in tamper tests. An occupied-block edit that preserves all decoded bits may legitimately pass, and a test will prove this stated limitation.

### Integration

Keep codec and DCT envelope separate from existing LSB protocol code. Extend API request validation, capacity responses, result typing, download naming, handoff method metadata, and verification dispatch. Existing downloaded LSB files remain compatible. Inspection continues to provide descriptive pixel-domain evidence, not a claim to detect DCT payloads.

Tamper-test dispatch uses the appropriate verifier. LSB-specific attacks that assume pixel-slot framing are labelled unsupported for DCT rather than misapplied. General image transformations can run against DCT outputs and show measured recovery/verification outcomes without promising robustness.

Use a shared framing detector for independent uploads, extraction, and tamper tests. Probe both bootstrap signatures without decryption; reject ambiguity if both are recognized. Recognized DCT framing never falls back to LSB after a version, bounds, or authentication failure. An unsupported DCT version reports unsupported format; no recognized framing reports missing/damaged payload. A recognized encrypted header that fails authentication reports wrong passphrase or altered header without claiming to distinguish them. Handoff metadata is only a UI hint. Hide manual pixel/sample-location controls for detected DCT inputs; reject supplied manual LSB overrides for DCT in the API.

## 5. Tamper-test presentation

Remove MSE, PSNR, SSIM, quality charts, and associated explanatory copy from Tamper tests, including the image robustness simulator. Retain transformation parameters, previews, dimensions, baseline verdict, per-scenario verification outcomes, and downloads. JPEG quality remains an attack input parameter, not an image-quality result metric. Keep quality evidence in embedding/inspection where already relevant. Preserve compatible API fields if other consumers require them; this request is about tamper-test presentation.

## 6. Independent text workspace

Do not render the media Working file strip on Text Steganography. Remove the text page's dependency on the media workspace reset key so clearing/replacing a media file does not reset text state. Keep the text workflow's existing file controls and key behavior.

## Verification and acceptance

Routing semantics: sidebar return restores the last embedding view; explicit form URLs and Edit show the form; Back/Forward honor their URL; selecting another cover or clearing results invalidates saved result availability. Completion during navigation stores the result without pulling the user away from the active screen. Video owns its existing inline result view and reports availability independently of RSA result state, avoiding an RSA-only redirect gate.

- UI regression: embed, leave via sidebar, return, and download the same successful artifact; edit/back/deep-link behavior remains consistent.
- UI regression: media working-file strip is absent on the text route, and media clearing does not erase text work.
- UI regression: each bit-layer source opens with the correct label/image; zoom, Escape, focus restoration, and stale-analysis handling work.
- Layout check: unequal statistical panel heights and full-width bit layers at desktop and narrow widths, including analysis without a reference image or RS evidence.
- Tamper UI regression: image-quality metrics and charts are absent; attack settings and verification outcomes remain.
- Codec tests: round-trip exact bytes through serialized PNG for textured, flat, saturated, RGB/RGBA, and non-multiple-of-eight dimensions; capacity boundaries; bounded failure for unstable carriers; malformed headers; unchanged dimensions, edges, and alpha.
- End-to-end DCT tests: signed/encrypted text and binary payloads, independent download/reupload recovery, wrong passphrase/key, payload corruption, and modification of non-embedding pixels.
- Assert no content release on a signed/header placement mismatch, dimension mismatch, or protected-pixel hash mismatch. Cover unsupported versions, ambiguous framing, malformed lengths, and explicit override rejection.
- Use sufficiently large textured, mid-gray, black, and white RGB fixtures as required successful codec round trips; other pathological inputs may fail safely only with the documented error. Verify a bit-preserving occupied-block edit is not falsely promised to be detectable.
- Regression: existing LSB image/audio and text tests, affected API tests, frontend tests, and production TypeScript build. Check video result navigation where it shares app-level routing.

## Delivery

Implement as focused UI fixes plus an isolated DCT feature with integration tests. No git commit or push without an explicit user request. This design requires user review before the implementation plan.
