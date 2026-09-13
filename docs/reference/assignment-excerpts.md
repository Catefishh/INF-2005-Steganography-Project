# Assignment excerpts and design reference

Source: the INF2005 ACW1 2026 assignment text and image supplied by the user in this planning conversation. These excerpts preserve the required sample payloads for implementation and reproduction; the implementation plan contains the requirement mapping.

## Short payload — Learning Objective 1

Encode the following as UTF-8 with no leading/trailing whitespace and no final newline:

```text
Explain how steganography can be used to embed hidden verification data in image and audio cover objects.
```

## Large payload — Project Overview

Encode the following as one UTF-8 paragraph with single spaces between sentences and no final newline. Only PDF layout line breaks have been removed:

```text
This undergraduate project requires student teams to design, implement and demonstrate a GUI-based LSB Replacement steganography program (window-based or web-based) that protects and verifies both image and audio cover objects using steganography, hashing and digital signatures. The project focuses on practical cybersecurity concepts: hiding a verification payload inside an image and an audio file, signing relevant verification data, extracting the hidden payload, checking the digital signature, and demonstrating positive and negative verification cases. Video as a cover object is not required for the main assignment, but may be attempted as an optional challenge.
```

## Custom payload

The team must choose its own relevant content and record its provenance. Use the same arbitrary-file input and encrypted signed-package workflow as user content. Record actual input/output byte lengths and SHA-256 values when generating evidence; do not hardcode expected production results.

## Dashboard reference — required asset before visual implementation

The user's supplied 800×269 dashboard image is visible in the conversation but is not currently a repository file. Save that original attachment to `docs/reference/dashboard-reference.png` before implementation Task 7. Do not substitute a generated image or claim the asset exists until it is supplied.

Visual facts visible in the attachment:

- A narrow dark slate navigation rail on the left.
- A broad pale blue-gray/white instrument surface.
- Layered cyan/turquoise, coral, amber and muted slate signal curves.
- Thin grid lines, small technical controls, circular instruments and waveform plots.
- A wide, horizontally arranged comparison/instrument composition.

The plan translates these into a readable media workbench. Its hexadecimal palette values are provisional visual approximations, not sampled-color claims. The original image is a design reference only, not an application background or evidence of implemented functionality.
