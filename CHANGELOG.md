# Changelog


## 0.8.6 - Mobile receipt and manual mileage integration

- Added authenticated mobile odometer updates that write to the selected GarageLog vehicle and mileage history.
- Added mobile fuel-receipt uploads as normal GarageLog receipt documents with pending review status.
- Added local receipt OCR suggestions for gallons, total amount, merchant, and price per gallon when available.
- Added pending-receipt review in Documents; approval creates and links a Fuel expense.
- Reworked the OBD Devices & Mileage settings layout so vehicle association and trust controls no longer crowd or overlap.

## 0.8.0 - OBD devices, mileage trust, and UI improvements

- Added persistent GarageLog OBD device registration by device ID.
- Added VIN-first vehicle matching with saved device-to-vehicle association fallback.
- Added conflict handling when a device pairing and detected VIN disagree.
- Added safe odometer proposals from telemetry instead of automatic mileage overwrite.
- Added administrator controls in Settings for OBD device associations and odometer proposals.
- Added mobile API endpoints for vehicle discovery and OBD device association.
- Telemetry trip uploads now return vehicle-association and odometer-proposal status.

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

