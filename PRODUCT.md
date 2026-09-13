# Stegloc Product Decisions

This file records the approved v1 direction. It is a plan, not an implementation claim.

## Platform

- Stegloc is a local web application with a React frontend and Python backend.
- The v1 interface will use an instrument-workbench direction. Visual styling is deferred because the reference dashboard image is unavailable.

## Recovery

- Recovery uses an encrypted `.stegloc` locator sidecar and a separate randomly generated recovery code.
- The sidecar and recovery code must remain separate recovery factors.

## Carrier Rollout

- Mandatory baseline support is image and audio: PNG, BMP, and integer PCM WAV.
- BMP and WAV outputs preserve exact carrier byte length.
- PNG preserves dimensions but is explicitly labelled variable-size because recompression can change encoded length.
- Restricted AVI is allowed only after the mandatory image/audio baseline is complete.
- The later AVI subset preserves exact carrier byte length.

Tasks 1-6 implement the approved image/audio baseline, including media embedding, extraction, recovery, authenticity verification, bounded sessions, and cancellation-safe publication. The functional UI remains deferred.
