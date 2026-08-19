# Changelog

## 0.8.12 - Pump OCR lab reader integration and temp cleanup

- Replaced the earlier pump seven-segment reader with the standalone lab-tuned transaction reader used during field-image testing.
- Preserves conservative recognition: only completed-sale amount and gallons are returned; grade prices are validation context only.
- Keeps difficult/extreme pump photos in manual-review fallback instead of forcing uncertain values.
- Runs pump analysis in an isolated temporary working directory and removes it after each read.
- Cleans stale GarageLog pump-analysis and ImageMagick preprocessing artifacts so temporary OCR images do not accumulate.


## 0.8.11 - Transaction-aware pump reading

- Pump-display OCR now targets exactly two completed-transaction values: Total/This Sale and Gallons.
- Price per gallon is derived from total sale divided by gallons and used only as a sanity check; GarageLog does not treat pump grade-price boards as transaction data.
- Added support for both traditional stacked sale/gallons LCD windows and newer shared transaction panels.
- Added perspective correction and automatic bright-on-dark vs dark-on-light display handling for seven-segment panels.
- Replaced the previous segment-contour-only decoder with digit grouping plus fixed segment probes, which is more tolerant of varied segment thickness and display color.
- Grade selection / price-per-gallon boards are rejected when a completed sale-and-gallons pair cannot be confidently established.
- Tightened transaction validation to prefer manual review over accepting a mathematically plausible but suspicious OCR pair.

## 0.8.10 - Seven-segment pump reader

- Added a dedicated OpenCV-based seven-segment reader for common dual-display fuel pumps instead of relying on Tesseract to interpret segmented digits.
- The pump reader extracts sale amount and gallons independently, validates the implied price per gallon, and feeds high-confidence values into the existing pending-review workflow.
- Tesseract remains available for searchable text and as the fallback for pump layouts that the seven-segment reader cannot identify.
- Pump review fields no longer present failed OCR zeros as detected values; missing values stay blank and show a clear manual-entry/retake message.
- Docker now includes the OpenCV runtime required by the specialized pump reader.

## 0.8.9 - Pump display OCR and mobile receipt review

- Added pump-display vs paper-receipt capture types for GarageLog Mobile uploads.
- Added pump-specific multi-pass OCR with numeric-focused Tesseract passes.
- Added optional ImageMagick preprocessing for photographed pump displays; the Docker image now includes ImageMagick.
- Stores the mobile capture type on pending receipt documents for clearer review.
- Pending mobile receipts now show an explicit OCR processing state and do not allow approval until OCR completes.



## 0.8.8

- Mobile vehicle summaries now use the same full vehicle title shown in GarageLog, including trim.
- Retains the 0.8.7 mobile vehicle type and authenticated vehicle-image support required by GarageLog Mobile 0.3.0.

## 0.8.7 - Mobile vehicle image support

- Extended the mobile vehicle list with vehicle type and stored-image metadata.
- Added authenticated mobile vehicle-image retrieval so GarageLog Mobile can show the same uploaded vehicle image as the server.


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

