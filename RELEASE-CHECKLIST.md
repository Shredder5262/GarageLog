# Release checklist

Run these checks from the repository root before creating a public release. Also choose and add the software license that matches how the repository should be used; this package intentionally does not assume one.

```bash
# Confirm no local data, databases, secrets, logs, archives, or shell installers are tracked.
find . -type f \
  \( -iname '*.db' -o -iname '*.db-*' -o -iname '*.sqlite*' -o -iname '*.log' \
     -o -iname '.env' -o -iname '*.zip' -o -iname '*.7z' -o -iname '*.ps1' \) -print

# Search for common local-path, credential, and private-network markers.
grep -RInE 'C:\\Users\\|/Users/|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|api[_-]?key|client[_-]?secret' . \
  --exclude-dir=.git --exclude='RELEASE-CHECKLIST.md' --exclude='validate.yml'

# Validate JavaScript and archive inputs.
node --check src/GarageLog.Web/wwwroot/app.js
dotnet build src/GarageLog.Web/GarageLog.Web.csproj -c Release

docker compose config
docker build --pull -t garagelog:release-test .
docker run --rm --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --tmpfs /tmp --mount type=volume,src=garagelog-release-test,dst=/app/data \
  -p 6001:6001 garagelog:release-test
```

After testing, create a clean tag such as `v0.7.0`. The GitHub workflow can publish the image to GitHub Container Registry when a version tag is pushed.
