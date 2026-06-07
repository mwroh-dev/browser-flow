# Security Policy

- Default masked capture keeps URLs local; explicit `--unmasked --start-url <url>` is required for real-site diagnostic capture.
- Real-site runs must not promote beyond diagnostic capture unless registry and verification gates allow it.
- Capture runs must use an isolated Chrome `user-data-dir`.
- Raw observation remains in memory until sanitization.
- Never persist unredacted:
  - cookies
  - auth headers
  - session values
  - CSRF tokens
  - passwords
  - raw storage dumps
  - raw screenshots
- Verification and security reports must also be sanitized before persistence.
