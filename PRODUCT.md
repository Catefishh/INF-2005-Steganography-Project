# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The application has a local React interface backed by Python, available in a browser or a packaged Windows desktop window.

## Users

INF2005 student team members demonstrating their implementation, markers reproducing the evidence, and a sender and recipient protecting and verifying their own media files.

## Product Purpose

Hide a verification record and user-supplied content in image and audio carriers through LSB replacement, then extract the content and verify its digital signature and integrity. Include video-inside-video as a later v1 extension after the mandatory workflows pass.

## Operating Context

- Assignment demonstration of no more than 25 minutes, with every team member participating.
- Sender A exports protected media; recipient B downloads it to a separate folder and verifies it using the sender's public key.
- Submission includes source, setup instructions, sample media, test evidence, a demo plan, signed originality and contribution statements, and key-reproduction instructions.

## Capabilities and Constraints

- Mandatory image and audio covers, variable secured start locations, compact verification metadata, hashes, digital signatures, extraction, and explained verification verdicts.
- Selectable LSB depth from 1 through 8, with convenient 1/2/3-bit choices.
- Drag-and-drop and file-picker input, flexible payload file types, and input/output comparison with media playback where supported.
- Runtime user files, keys, and parameters; demonstration fixtures must not be required by the application.
- Exact byte-length preservation for compatible BMP and WAV carriers, with a separately labelled variable-size PNG export path.
- Recovery uses an encrypted `.stegloc` sidecar and a separate randomly generated recovery code.
- Confidentiality uses AES-256-GCM; Ed25519 and SHA-256 provide signing and integrity evidence.
- Restricted uncompressed AVI remains a later milestone after the mandatory image/audio baseline.

## Brand Commitments

Follow the user's supplied instrument-dashboard reference: pale cool surfaces, dark slate navigation, cyan/turquoise, coral, restrained amber, fine technical linework, and prominent media/signal visualizations. Keep controls readable during a classroom demonstration.

## Evidence On Hand

The five-page INF2005 ACW1 assignment text and dashboard reference were supplied in the conversation. Required sample text is preserved in `docs/reference/assignment-excerpts.md`; the dashboard image must be saved to `docs/reference/dashboard-reference.png` before visual implementation. Actual test evidence and team contribution percentages must be produced by the team.

## Implementation Status

The original RSA/passphrase image/audio workflow, GUI, attack lab and Windows desktop distribution are present. V2 adds a separate Ed25519/recovery-file workflow, session-scoped jobs, image BPCS analysis and restricted AVI video carriers. V3 adds RS analysis, paired bit-plane and quality comparison, maximum usable payload capacity, secured text carriers and configurable image robustness. The legacy media protocols remain available for older files. See `docs/v2-protocol.md` for their format limits and the README for v3 features.

## Product Principles

- Make the security workflow explainable and reproducible.
- Prove the image and audio requirements before building the video extension.
- Report exact-size guarantees and verification limits truthfully.
- Keep the sender's private key separate from recipient verification material.
- Let users work with their own supported files without changing source code.
