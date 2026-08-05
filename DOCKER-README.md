# GarageLog 0.7.1 Docker Package

This package is a clean Docker build context and deployment bundle. It contains application source code and Docker configuration only. It does not contain a GarageLog database, uploaded documents, images, logs, passwords, secrets, PowerShell files, or personal data.

## Build and run locally

1. Copy `.env.example` to `.env`.
2. Set `GARAGELOG_BIND_ADDRESS=0.0.0.0` only when GarageLog should be reachable from other devices on a trusted LAN.
3. From this folder, run:

```bash
docker compose up -d --build
```

GarageLog will be available at `http://127.0.0.1:6001` with the default settings.

Application data is stored in the named Docker volume `garagelog-data` and survives container replacement.

## Push the locally built image to GitHub Container Registry

Authenticate to GHCR using a GitHub personal access token with package write permission:

```bash
docker login ghcr.io -u YOUR_GITHUB_USERNAME
```

Build and push the versioned image:

```bash
docker compose build
docker push ghcr.io/shredder5262/garagelog:0.7.1
```

Optionally publish the same image as `latest`:

```bash
docker tag ghcr.io/shredder5262/garagelog:0.7.1 ghcr.io/shredder5262/garagelog:latest
docker push ghcr.io/shredder5262/garagelog:latest
```

Package visibility can then be changed in the GitHub Container Registry package settings.

## Deploy from GHCR

After the image has been published:

```bash
docker compose -f compose.ghcr.yaml up -d
```

To use a different tag, set `GARAGELOG_IMAGE` in `.env`.

## Upgrade without deleting data

```bash
docker compose -f compose.ghcr.yaml pull
docker compose -f compose.ghcr.yaml up -d
```

Do not run `docker compose down -v` unless you intentionally want to delete the persistent GarageLog data volume.

## Included runtime tools

The image installs Tesseract OCR, Poppler, LibreOffice, and qrencode inside the container. Nothing needs to remain running separately on the host.

## Security defaults

The container runs as a non-root user, uses a read-only root filesystem, drops Linux capabilities, enables `no-new-privileges`, limits processes, and binds to loopback by default. Do not expose GarageLog directly to the public internet. Use HTTPS through a trusted reverse proxy for remote access.
