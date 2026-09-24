# Product

<!-- impeccable:product-schema 1 -->

## Platform

desktop and web

The application has a local React interface backed by Python, available in a browser or a packaged Windows desktop window.

## Users

INF2005 student team members demonstrating their implementation, markers reproducing the evidence, and a sender and recipient protecting and verifying their own media files.

## Product Purpose

Hide a verification record and user-supplied content in image, audio and supported video carriers, then extract the content and verify its digital signature and integrity. Present the workflows in one accessible desktop-first studio.

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
- Restricted uncompressed AVI is supported through the Ed25519 media workflow.

## Brand Commitments

Follow the supplied Luminous Spatial Glass direction: pale cool canvas, translucent navigation, opaque technical evidence, sky-cyan controls, slate type, and restrained semantic warning/error colors. Keep controls readable during a classroom demonstration.

## Evidence On Hand

The INF2005 assignment excerpts remain in `docs/reference/assignment-excerpts.md`. The current interface follows the supplied Luminous Spatial Glass specification and the adopted component patterns documented in `docs/ui-library-adoption.md`. Protocol formats and analysis limitations are documented separately.

## Implementation Status

The app combines the RSA/passphrase image/audio workflow, Ed25519 recovery-file media protocol, signed text protocol, attack lab, descriptive steganalysis and Windows desktop distribution. The interface is a single workflow-first studio. Protocol identifiers remain versioned for compatibility; they are not separate product releases. See `docs/v2-protocol.md`, `docs/v3-text-protocol.md`, and the README for format limits and current workflows.

## Product Principles

- Make the security workflow explainable and reproducible.
- Prove the image and audio requirements before building the video extension.
- Report exact-size guarantees and verification limits truthfully.
- Keep the sender's private key separate from recipient verification material.
- Let users work with their own supported files without changing source code.
