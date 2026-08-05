# Changelog

## 0.7.0 - Docker release and security hardening

- Added a multi-stage Docker build with OCR, PDF, Office-preview, and QR dependencies.
- Added a hardened Compose configuration using a non-root user, dropped capabilities, a read-only root filesystem, `no-new-privileges`, a temporary filesystem, health checks, and a persistent data volume.
- Added persistent ASP.NET Core data-protection keys for stable authentication sessions across container replacement.
- Added login/setup rate limiting, a required same-origin API verification header, stricter security headers, optional HTTPS enforcement, and explicitly configured trusted-proxy support.
- Restricted document uploads to supported file extensions and validates PDF and common image signatures.
- Removed all PowerShell installers and Windows-specific setup downloads from the public package.
- Added an optional, privacy-conscious GitHub release checker. Administrators receive a bell notification and dashboard message when a newer release is available.
- Updated Microsoft.Data.Sqlite to the current .NET 8 servicing release used by this package.
- Removed duplicated frontend source copies from the repository package.
- Added release, privacy, and security documentation plus GitHub dependency, validation, container publishing, SBOM/provenance, and generated-release workflows.
- Added separate hardened Compose definitions for local builds and published GHCR images.
- Defaulted published ports to loopback, added restrictive file creation permissions, disabled .NET CLI telemetry in the image, and raised the minimum password length for new or changed passwords to 12 characters.

## 0.6.5

- Refined Budget View action-button sizing.

## 0.6.4

- Added notification clearing and the Expenses Budget View.

## 0.6.3

- Added first-run vehicle setup, storage management, document QR sharing, and report chart refinements.

## 0.6.0–0.6.2

- Added local authentication, user roles and permissions, report templates, notifications, and fuel/mileage reporting refinements.
