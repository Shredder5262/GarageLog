# Release checklist

GarageLog now uses the repository-root `VERSION` file as the single application-version source.
`Directory.Build.props` feeds that value into the .NET assembly, the server reads the compiled
assembly version at runtime, and Help & About reads the running server version from `/healthz`.
Do not add application-version literals to `GarageLog.Web.csproj`, `Program.cs`, `app.js`, or
static asset query strings.

Run these checks from the repository root before creating a public release. Also choose and add
the software license that matches how the repository should be used; this package intentionally
does not assume one.

```bash
# Confirm no local data, databases, secrets, logs, archives, or shell installers are tracked.
find . -type f \
  \( -iname '*.db' -o -iname '*.db-*' -o -iname '*.sqlite*' -o -iname '*.log' \
     -o -iname '.env' -o -iname '*.zip' -o -iname '*.7z' -o -iname '*.ps1' \) -print

# Search for common local-path, credential, and private-network markers.
grep -RInE 'C:\\Users\\|/Users/|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|api[_-]?key|client[_-]?secret' . \
  --exclude-dir=.git --exclude='RELEASE-CHECKLIST.md' --exclude='validate.yml'

# Validate JavaScript and the Release build.
node --check src/GarageLog.Web/wwwroot/app.js
node --check src/GarageLog.Web/wwwroot/settings.js
dotnet build src/GarageLog.Web/GarageLog.Web.csproj -c Release

docker compose config
docker build --pull -t garagelog:release-test .
docker run --rm --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --tmpfs /tmp --mount type=volume,src=garagelog-release-test,dst=/app/data \
  -p 6001:6001 garagelog:release-test
```

## Version and publish

1. Change **only** the value in `VERSION`, for example `0.8.3`.
2. Commit and push that change to `main`.
3. Create the matching tag, for example `v0.8.3`, and push it.

The Docker publish workflow refuses a version tag that does not match `VERSION`, preventing a
release whose Git tag, Docker image, server health endpoint, and Help & About version disagree.
