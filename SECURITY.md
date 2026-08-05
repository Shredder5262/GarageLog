# Security

## Supported release

Security fixes are applied to the current GarageLog release line.

## Deployment expectations

GarageLog is designed for self-hosting on a trusted local network. Use HTTPS through a maintained reverse proxy or a private VPN before providing remote access. Do not publish the application port directly to the public internet.

The container runs as the .NET non-root `app` user, drops Linux capabilities, enables `no-new-privileges`, uses a read-only root filesystem, applies a restrictive file-creation mask, and writes only to the persistent data volume and temporary filesystem. Compose binds to loopback by default; deliberately set `GARAGELOG_BIND_ADDRESS=0.0.0.0` only for direct access from a trusted LAN.

Authentication cookies are HTTP-only and SameSite Strict. Data-protection keys persist in the GarageLog data volume so sessions remain valid across container replacement. Credential endpoints are rate limited, unsafe API calls require a same-origin verification header, and user permissions are also enforced by the server.

## Sensitive data

Never commit or attach the following to an issue or release:

- `garagelog.db` or any SQLite sidecar files
- the `data` directory or Docker volume exports
- stored documents or OCR output
- vehicle or profile images
- `.env` files, reverse-proxy credentials, tokens, or logs

## Reporting a vulnerability

Use GitHub's private vulnerability reporting feature when enabled for the repository. Do not post authentication bypasses, document-access issues, or data-exposure details in a public issue before a fix is available.

## Remaining hardening work

The current interface still uses inline event handlers and inline styles in several legacy views, so the Content Security Policy must presently allow inline script and style execution. A future frontend refactor should replace those handlers with registered event listeners and remove `unsafe-inline` from the policy. Treat each release as self-hosted software rather than a security boundary for an untrusted public network.

Before publishing, enable GitHub secret scanning, Dependabot alerts, private vulnerability reporting, and branch protection for the default branch when those repository features are available.
