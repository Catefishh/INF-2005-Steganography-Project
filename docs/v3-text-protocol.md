# V3 secured text carriers

Text v3 is separate from STG1 and the v2 image/audio/video recovery format. A carrier is UTF-8 text, a `.stegloc-text` recovery file is JSON, and the recovery code is shared separately.

The hidden byte frame is `STXT3 | big-endian 32-bit body length | salt(16) | nonce(12) | AES-256-GCM ciphertext+tag`. Its AES key comes from HKDF-SHA256 over a fresh 32-byte recovery secret, the frame salt, and context `stegloc/text/v3\0`; AES associated data is that context plus the method name. The 43-character URL-safe recovery code represents the secret.

The encrypted JSON package contains a record (`version`, method, UTF-8 message byte length and SHA-256), the Base64 message, and an Ed25519 signature. The signature covers the domain-separated canonical record and raw message bytes. The recovery JSON records version, method, and the complete frame SHA-256. A recipient checks frame syntax and hash, decrypts, verifies the signature, checks length/hash, and only then releases the UTF-8 message.

Acrostics use two line initials in A–P per frame byte (high nibble, then low nibble). Whitespace uses one trailing space for 0 or tab for 1 per line. Zero-width uses U+200B for 0 and U+200C for 1. The receiver rejects extra/missing encoded symbols; acrostic sentence bodies may be rewritten if their initials and line order stay unchanged. Visible text is **not authenticated**. A correct signature authenticates the hidden message and signer, not the visible prose or its readability.

Message input is limited to 32 KiB and output carrier text to 2 MiB. Whitespace and zero-width text is fragile under editors, mail services, or copy/paste that strip or normalize characters. Acrostic carriers become long because encrypted bytes must be represented by initials. This format is a classroom demonstration, not a way to prove that a carrier is covert.
