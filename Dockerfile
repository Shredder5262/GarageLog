# syntax=docker/dockerfile:1.7
FROM mcr.microsoft.com/dotnet/sdk:8.0-bookworm-slim AS build
WORKDIR /src
COPY src/GarageLog.Web/GarageLog.Web.csproj src/GarageLog.Web/
RUN dotnet restore src/GarageLog.Web/GarageLog.Web.csproj
COPY src/GarageLog.Web/ src/GarageLog.Web/
RUN dotnet publish src/GarageLog.Web/GarageLog.Web.csproj \
    --configuration Release \
    --output /app/publish \
    --no-restore \
    /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0-bookworm-slim AS final
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        libreoffice-calc \
        libreoffice-core \
        libreoffice-writer \
        poppler-utils \
        qrencode \
        tesseract-ocr \
        tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/publish .
RUN mkdir -p /app/data /tmp/garagelog \
    && chown -R app:app /app /tmp/garagelog \
    && chmod 700 /app/data /tmp/garagelog

ENV ASPNETCORE_URLS=http://+:6001 \
    DOTNET_EnableDiagnostics=0 \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1 \
    GarageLog__DataDirectory=/app/data \
    HOME=/tmp/garagelog \
    TMPDIR=/tmp

USER app
EXPOSE 6001
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD ["curl", "--fail", "--silent", "http://127.0.0.1:6001/healthz"]
ENTRYPOINT ["/bin/sh", "-c", "umask 077 && exec dotnet GarageLog.Web.dll"]
