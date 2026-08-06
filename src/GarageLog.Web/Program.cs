using System.Diagnostics;
using System.IO.Compression;
using System.Security.Claims;
using System.Text.Json.Nodes;
using System.Net;
using System.Net.Http.Headers;
using System.Threading.RateLimiting;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Microsoft.Data.Sqlite;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Identity;
using UglyToad.PdfPig;
using UglyToad.PdfPig.DocumentLayoutAnalysis.TextExtractor;

const string GarageLogVersion = "0.7.4";
var builder = WebApplication.CreateBuilder(args);

builder.WebHost.UseUrls(
    Environment.GetEnvironmentVariable("ASPNETCORE_URLS")
    ?? "http://0.0.0.0:6001");
builder.WebHost.ConfigureKestrel(options =>
{
    options.AddServerHeader = false;
    options.Limits.MaxRequestBodySize = 110L * 1024L * 1024L;
});

var configuredDataDirectory = builder.Configuration["GarageLog:DataDirectory"] ?? "data";
var databaseFile = builder.Configuration["GarageLog:DatabaseFile"] ?? "garagelog.db";
var dataDirectory = Path.GetFullPath(
    Path.IsPathRooted(configuredDataDirectory)
        ? configuredDataDirectory
        : Path.Combine(builder.Environment.ContentRootPath, configuredDataDirectory));
var dataProtectionDirectory = Path.Combine(dataDirectory, "data-protection-keys");
Directory.CreateDirectory(dataDirectory);
Directory.CreateDirectory(dataProtectionDirectory);

var requireHttps = bool.TryParse(
    builder.Configuration["GarageLog:RequireHttps"]
        ?? Environment.GetEnvironmentVariable("GARAGELOG_REQUIRE_HTTPS"),
    out var configuredRequireHttps) && configuredRequireHttps;
var updateRepository = (
    builder.Configuration["GarageLog:Updates:Repository"]
        ?? Environment.GetEnvironmentVariable("GARAGELOG_UPDATE_REPOSITORY")
        ?? string.Empty).Trim();
var updateChecksEnabled = Regex.IsMatch(updateRepository, @"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$");
var updateCheckHours = int.TryParse(builder.Configuration["GarageLog:Updates:CheckIntervalHours"], out var configuredUpdateHours)
    ? Math.Clamp(configuredUpdateHours, 1, 24)
    : 6;
var trustedProxyValues = builder.Configuration.GetSection("GarageLog:TrustedProxies")
    .GetChildren()
    .Select(section => section.Value)
    .Where(value => !string.IsNullOrWhiteSpace(value))
    .Select(value => value!)
    .Concat((Environment.GetEnvironmentVariable("GARAGELOG_TRUSTED_PROXIES") ?? string.Empty)
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
    .Distinct(StringComparer.OrdinalIgnoreCase)
    .ToArray();

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.SerializerOptions.WriteIndented = true;
});
builder.Services.AddDataProtection()
    .SetApplicationName("GarageLog")
    .PersistKeysToFileSystem(new DirectoryInfo(dataProtectionDirectory));
builder.Services.AddHttpClient("GarageLogUpdates", client =>
{
    client.BaseAddress = new Uri("https://api.github.com/");
    client.Timeout = TimeSpan.FromSeconds(12);
    client.DefaultRequestHeaders.UserAgent.ParseAdd($"GarageLog/{GarageLogVersion}");
    client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
    client.DefaultRequestHeaders.TryAddWithoutValidation("X-GitHub-Api-Version", "2022-11-28");
});
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("auth", context => RateLimitPartition.GetFixedWindowLimiter(
        partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        factory: _ => new FixedWindowRateLimiterOptions
        {
            AutoReplenishment = true,
            PermitLimit = 10,
            QueueLimit = 0,
            Window = TimeSpan.FromMinutes(1)
        }));
});
if (trustedProxyValues.Length > 0)
{
    builder.Services.Configure<ForwardedHeadersOptions>(options =>
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        options.ForwardLimit = 1;
        foreach (var value in trustedProxyValues)
            if (IPAddress.TryParse(value, out var address)) options.KnownProxies.Add(address);
    });
}
builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "GarageLog.Auth";
        options.Cookie.HttpOnly = true;
        options.Cookie.IsEssential = true;
        options.Cookie.Path = "/";
        options.Cookie.SameSite = SameSiteMode.Strict;
        options.Cookie.SecurePolicy = requireHttps ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
        options.ExpireTimeSpan = TimeSpan.FromHours(12);
        options.SlidingExpiration = true;
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };
    });
builder.Services.AddAuthorization(options =>
{
    options.FallbackPolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .Build();
    options.AddPolicy("Administrator", policy => policy.RequireRole(UserRoles.Administrator));
});
builder.Services.AddSingleton<IPasswordHasher<GarageLogUser>, PasswordHasher<GarageLogUser>>();

var app = builder.Build();
var legacyDataDirectory = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "data"));
var databasePath = Path.Combine(dataDirectory, databaseFile);
var legacyDatabasePath = Path.Combine(legacyDataDirectory, databaseFile);
if (!string.Equals(dataDirectory, legacyDataDirectory, StringComparison.OrdinalIgnoreCase)
    && !File.Exists(databasePath)
    && File.Exists(legacyDatabasePath))
{
    CopyDirectoryContents(legacyDataDirectory, dataDirectory);
}
var documentsDirectory = Path.Combine(dataDirectory, "documents");
Directory.CreateDirectory(documentsDirectory);
var documentPreviewDirectory = Path.Combine(dataDirectory, "document-previews");
Directory.CreateDirectory(documentPreviewDirectory);
var vehiclesDirectory = Path.Combine(dataDirectory, "vehicles");
Directory.CreateDirectory(vehiclesDirectory);
var profileImagesDirectory = Path.Combine(dataDirectory, "profile-images");
Directory.CreateDirectory(profileImagesDirectory);
var connectionString = new SqliteConnectionStringBuilder
{
    DataSource = databasePath,
    Mode = SqliteOpenMode.ReadWriteCreate,
    Cache = SqliteCacheMode.Shared
}.ToString();

await InitializeDatabaseAsync(connectionString);
var passwordHasher = app.Services.GetRequiredService<IPasswordHasher<GarageLogUser>>();
var updateCacheGate = new SemaphoreSlim(1, 1);
UpdateCacheEntry? updateCache = null;

if (trustedProxyValues.Length > 0) app.UseForwardedHeaders();
if (requireHttps)
{
    if (!app.Environment.IsDevelopment()) app.UseHsts();
    app.UseHttpsRedirection();
}
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = context =>
    {
        context.Context.Response.Headers.CacheControl = "no-store, no-cache, must-revalidate";
        context.Context.Response.Headers.Pragma = "no-cache";
        context.Context.Response.Headers.Expires = "0";
    }
});
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["X-Frame-Options"] = "DENY";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    context.Response.Headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()";
    context.Response.Headers["Cross-Origin-Opener-Policy"] = "same-origin";
    context.Response.Headers["Cross-Origin-Resource-Policy"] = "same-origin";
    context.Response.Headers["Content-Security-Policy"] = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-src 'self' blob:; child-src 'self' blob:; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'";
    await next();
});
app.UseRateLimiter();
app.UseAuthentication();
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api")
        && !HttpMethods.IsGet(context.Request.Method)
        && !HttpMethods.IsHead(context.Request.Method)
        && !HttpMethods.IsOptions(context.Request.Method))
    {
        if (!string.Equals(context.Request.Headers["X-GarageLog-Request"].ToString(), "1", StringComparison.Ordinal))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { error = "The request verification header is missing." });
            return;
        }
        var origin = context.Request.Headers.Origin.ToString();
        if (!string.IsNullOrWhiteSpace(origin)
            && Uri.TryCreate(origin, UriKind.Absolute, out var originUri)
            && !string.Equals(originUri.Authority, context.Request.Host.Value, StringComparison.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { error = "The request origin was rejected." });
            return;
        }
    }

    if (context.User.Identity?.IsAuthenticated == true)
    {
        var userId = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
        var securityStamp = context.User.FindFirstValue("garagelog:security_stamp");
        var databaseUser = string.IsNullOrWhiteSpace(userId) ? null : await ReadUserByIdAsync(connectionString, userId);
        if (databaseUser is null
            || !databaseUser.IsActive
            || !string.Equals(databaseUser.SecurityStamp, securityStamp, StringComparison.Ordinal))
        {
            await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            context.User = new ClaimsPrincipal(new ClaimsIdentity());
            if (context.Request.Path.StartsWithSegments("/api/auth/session")
                || context.Request.Path.StartsWithSegments("/api/auth/login")
                || context.Request.Path.StartsWithSegments("/api/auth/setup"))
            {
                await next();
                return;
            }
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            if (context.Request.Path.StartsWithSegments("/api"))
                await context.Response.WriteAsJsonAsync(new { error = "Your GarageLog session is no longer valid." });
            return;
        }

        context.Items[GarageLogAuthConstants.CurrentUserItemKey] = databaseUser;
        var isUnsafe = !HttpMethods.IsGet(context.Request.Method)
            && !HttpMethods.IsHead(context.Request.Method)
            && !HttpMethods.IsOptions(context.Request.Method);
        if (isUnsafe
            && context.Request.Path.StartsWithSegments("/api")
            && !CanUseUnsafeEndpoint(databaseUser, context.Request.Path))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { error = "This account has read-only access." });
            return;
        }
    }

    await next();
});
app.UseAuthorization();

app.MapGet("/api/auth/session", async (HttpContext context) =>
{
    var configured = await CountUsersAsync(connectionString) > 0;
    if (!configured) return Results.Ok(new { configured = false, authenticated = false });
    var user = CurrentUser(context);
    return user is null
        ? Results.Ok(new { configured = true, authenticated = false })
        : Results.Ok(new { configured = true, authenticated = true, user = ToUserDto(user) });
}).AllowAnonymous();

app.MapPost("/api/auth/setup", async (AuthSetupRequest request, HttpContext context) =>
{
    if (await CountUsersAsync(connectionString) > 0)
        return Results.Conflict(new { error = "GarageLog already has an administrator account." });
    var validation = ValidateNewCredentials(request.Username, request.DisplayName, request.Password);
    if (validation is not null) return Results.BadRequest(new { error = validation });
    var now = DateTimeOffset.UtcNow;
    var user = new GarageLogUser
    {
        Id = Guid.NewGuid().ToString("N"),
        Username = request.Username.Trim(),
        DisplayName = request.DisplayName.Trim(),
        Role = UserRoles.Administrator,
        AccessLevel = AccessLevels.ReadWrite,
        VisibilityScope = VisibilityScopes.AllVehicles,
        AssignedVehicleIdsJson = "[]",
        IsActive = true,
        SecurityStamp = Guid.NewGuid().ToString("N"),
        CreatedUtc = now,
        UpdatedUtc = now
    };
    user.PasswordHash = passwordHasher.HashPassword(user, request.Password);
    await SaveUserAsync(connectionString, user);
    await SignInUserAsync(context, user, rememberMe: true);
    return Results.Ok(new { configured = true, authenticated = true, user = ToUserDto(user) });
}).AllowAnonymous().RequireRateLimiting("auth");

app.MapPost("/api/auth/login", async (AuthLoginRequest request, HttpContext context) =>
{
    var username = request.Username?.Trim() ?? string.Empty;
    var user = await ReadUserByUsernameAsync(connectionString, username);
    if (user is null || !user.IsActive)
        return Results.Json(new { error = "The username or password is incorrect." }, statusCode: StatusCodes.Status401Unauthorized);
    var result = passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.Password);
    if (result == PasswordVerificationResult.Failed)
        return Results.Json(new { error = "The username or password is incorrect." }, statusCode: StatusCodes.Status401Unauthorized);
    if (result == PasswordVerificationResult.SuccessRehashNeeded)
    {
        user.PasswordHash = passwordHasher.HashPassword(user, request.Password);
        user.UpdatedUtc = DateTimeOffset.UtcNow;
    }
    user.LastLoginUtc = DateTimeOffset.UtcNow;
    await SaveUserAsync(connectionString, user);
    await SignInUserAsync(context, user, request.RememberMe);
    return Results.Ok(new { configured = true, authenticated = true, user = ToUserDto(user) });
}).AllowAnonymous().RequireRateLimiting("auth");

app.MapPost("/api/auth/logout", async (HttpContext context) =>
{
    await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    return Results.Ok(new { signedOut = true });
});

app.MapGet("/api/profile", (HttpContext context) =>
{
    var user = CurrentUser(context);
    return user is null ? Results.Unauthorized() : Results.Ok(ToUserDto(user));
});

app.MapPut("/api/profile", async (ProfileUpdateRequest request, HttpContext context) =>
{
    var user = CurrentUser(context);
    if (user is null) return Results.Unauthorized();
    var validation = ValidateUsernameAndDisplayName(request.Username, request.DisplayName);
    if (validation is not null) return Results.BadRequest(new { error = validation });
    var existing = await ReadUserByUsernameAsync(connectionString, request.Username.Trim());
    if (existing is not null && !string.Equals(existing.Id, user.Id, StringComparison.Ordinal))
        return Results.Conflict(new { error = "That username is already in use." });
    user.Username = request.Username.Trim();
    user.DisplayName = request.DisplayName.Trim();
    user.SecurityStamp = Guid.NewGuid().ToString("N");
    user.UpdatedUtc = DateTimeOffset.UtcNow;
    await SaveUserAsync(connectionString, user);
    await SignInUserAsync(context, user, rememberMe: true);
    return Results.Ok(ToUserDto(user));
});

app.MapPost("/api/profile/password", async (PasswordChangeRequest request, HttpContext context) =>
{
    var user = CurrentUser(context);
    if (user is null) return Results.Unauthorized();
    if (passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.CurrentPassword) == PasswordVerificationResult.Failed)
        return Results.BadRequest(new { error = "The current password is incorrect." });
    var passwordError = ValidatePassword(request.NewPassword);
    if (passwordError is not null) return Results.BadRequest(new { error = passwordError });
    user.PasswordHash = passwordHasher.HashPassword(user, request.NewPassword);
    user.SecurityStamp = Guid.NewGuid().ToString("N");
    user.UpdatedUtc = DateTimeOffset.UtcNow;
    await SaveUserAsync(connectionString, user);
    await SignInUserAsync(context, user, rememberMe: true);
    return Results.Ok(new { changed = true });
});

app.MapPost("/api/profile/image", async (HttpRequest request, HttpContext context) =>
{
    var user = CurrentUser(context);
    if (user is null) return Results.Unauthorized();
    if (!request.HasFormContentType) return Results.BadRequest(new { error = "Choose a profile image." });
    var form = await request.ReadFormAsync();
    var file = form.Files.GetFile("file");
    if (file is null || file.Length == 0) return Results.BadRequest(new { error = "Choose a non-empty profile image." });
    if (file.Length > 5L * 1024L * 1024L) return Results.BadRequest(new { error = "Profile images must be 5 MB or smaller." });
    var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
    if (extension is not (".jpg" or ".jpeg" or ".png" or ".webp"))
        return Results.BadRequest(new { error = "Profile images must be JPG, PNG, or WEBP." });
    await using var input = file.OpenReadStream();
    if (!await HasExpectedImageSignatureAsync(input, extension))
        return Results.BadRequest(new { error = "The selected file does not contain a valid supported image." });
    input.Position = 0;
    var storedName = $"{user.Id}-{Guid.NewGuid():N}{extension}";
    var destination = Path.Combine(profileImagesDirectory, storedName);
    await using (var output = File.Create(destination)) await input.CopyToAsync(output);
    if (!string.IsNullOrWhiteSpace(user.ProfileImageStoredName))
    {
        var oldPath = Path.Combine(profileImagesDirectory, Path.GetFileName(user.ProfileImageStoredName));
        if (File.Exists(oldPath)) File.Delete(oldPath);
    }
    user.ProfileImageStoredName = storedName;
    user.UpdatedUtc = DateTimeOffset.UtcNow;
    await SaveUserAsync(connectionString, user);
    return Results.Ok(ToUserDto(user));
});

app.MapDelete("/api/profile/image", async (HttpContext context) =>
{
    var user = CurrentUser(context);
    if (user is null) return Results.Unauthorized();
    if (!string.IsNullOrWhiteSpace(user.ProfileImageStoredName))
    {
        var path = Path.Combine(profileImagesDirectory, Path.GetFileName(user.ProfileImageStoredName));
        if (File.Exists(path)) File.Delete(path);
    }
    user.ProfileImageStoredName = null;
    user.UpdatedUtc = DateTimeOffset.UtcNow;
    await SaveUserAsync(connectionString, user);
    return Results.Ok(ToUserDto(user));
});

app.MapGet("/api/profile/image/{storedName}", (string storedName, HttpContext context) =>
{
    var requester = CurrentUser(context);
    if (requester is null) return Results.Unauthorized();
    var safeName = Path.GetFileName(storedName);
    if (!IsAdministrator(requester) && !safeName.StartsWith($"{requester.Id}-", StringComparison.OrdinalIgnoreCase))
        return Results.NotFound();
    var path = Path.Combine(profileImagesDirectory, safeName);
    if (!File.Exists(path)) return Results.NotFound();
    return Results.File(path, GetImageContentType(path), enableRangeProcessing: true);
});

app.MapGet("/api/admin/users", async () =>
{
    var users = await ReadUsersAsync(connectionString);
    return Results.Ok(users.Select(ToUserDto));
}).RequireAuthorization("Administrator");

app.MapPost("/api/admin/users", async (AdminCreateUserRequest request) =>
{
    var validation = ValidateNewCredentials(request.Username, request.DisplayName, request.Password);
    if (validation is not null) return Results.BadRequest(new { error = validation });
    if (await ReadUserByUsernameAsync(connectionString, request.Username.Trim()) is not null)
        return Results.Conflict(new { error = "That username is already in use." });
    var accessValidation = await ValidateManagedAccessAsync(connectionString, request.Role, request.VisibilityScope, request.AssignedVehicleIds);
    if (accessValidation is not null) return Results.BadRequest(new { error = accessValidation });
    var user = CreateManagedUser(request.Username, request.DisplayName, request.Role, request.AccessLevel, request.VisibilityScope, request.AssignedVehicleIds, true);
    user.PasswordHash = passwordHasher.HashPassword(user, request.Password);
    await SaveUserAsync(connectionString, user);
    return Results.Ok(ToUserDto(user));
}).RequireAuthorization("Administrator");

app.MapPut("/api/admin/users/{id}", async (string id, AdminUpdateUserRequest request, HttpContext context) =>
{
    var target = await ReadUserByIdAsync(connectionString, id);
    if (target is null) return Results.NotFound(new { error = "The user account was not found." });
    var validation = ValidateUsernameAndDisplayName(request.Username, request.DisplayName);
    if (validation is not null) return Results.BadRequest(new { error = validation });
    var duplicate = await ReadUserByUsernameAsync(connectionString, request.Username.Trim());
    if (duplicate is not null && !string.Equals(duplicate.Id, target.Id, StringComparison.Ordinal))
        return Results.Conflict(new { error = "That username is already in use." });
    var accessValidation = await ValidateManagedAccessAsync(connectionString, request.Role, request.VisibilityScope, request.AssignedVehicleIds);
    if (accessValidation is not null) return Results.BadRequest(new { error = accessValidation });
    var currentAdmin = CurrentUser(context);
    var removingAdmin = target.Role == UserRoles.Administrator
        && (!request.IsActive || !string.Equals(NormalizeRole(request.Role), UserRoles.Administrator, StringComparison.Ordinal));
    if (removingAdmin && await CountActiveAdministratorsAsync(connectionString) <= 1)
        return Results.BadRequest(new { error = "GarageLog must retain at least one active administrator." });
    if (currentAdmin is not null && target.Id == currentAdmin.Id && !request.IsActive)
        return Results.BadRequest(new { error = "You cannot deactivate the account currently in use." });
    target.Username = request.Username.Trim();
    target.DisplayName = request.DisplayName.Trim();
    ApplyManagedAccess(target, request.Role, request.AccessLevel, request.VisibilityScope, request.AssignedVehicleIds, request.IsActive);
    target.SecurityStamp = Guid.NewGuid().ToString("N");
    target.UpdatedUtc = DateTimeOffset.UtcNow;
    await SaveUserAsync(connectionString, target);
    if (currentAdmin is not null && target.Id == currentAdmin.Id)
        await SignInUserAsync(context, target, rememberMe: true);
    return Results.Ok(ToUserDto(target));
}).RequireAuthorization("Administrator");

app.MapPost("/api/admin/users/{id}/reset-password", async (string id, AdminResetPasswordRequest request, HttpContext context) =>
{
    var target = await ReadUserByIdAsync(connectionString, id);
    if (target is null) return Results.NotFound(new { error = "The user account was not found." });
    var passwordError = ValidatePassword(request.NewPassword);
    if (passwordError is not null) return Results.BadRequest(new { error = passwordError });
    target.PasswordHash = passwordHasher.HashPassword(target, request.NewPassword);
    target.SecurityStamp = Guid.NewGuid().ToString("N");
    target.UpdatedUtc = DateTimeOffset.UtcNow;
    await SaveUserAsync(connectionString, target);
    var currentAdmin = CurrentUser(context);
    if (currentAdmin is not null && target.Id == currentAdmin.Id)
        await SignInUserAsync(context, target, rememberMe: true);
    return Results.Ok(new { reset = true });
}).RequireAuthorization("Administrator");

app.MapGet("/healthz", () => Results.Ok(new
{
    status = "ok",
    application = "GarageLog",
    version = GarageLogVersion
})).AllowAnonymous();

app.MapGet("/api/health", async () => Results.Ok(new
{
    status = "ok",
    application = "GarageLog",
    version = GarageLogVersion,
    authenticationConfigured = await CountUsersAsync(connectionString) > 0,
    updateChecksConfigured = updateChecksEnabled,
    timeUtc = DateTimeOffset.UtcNow
})).RequireAuthorization("Administrator");

app.MapGet("/api/update/status", async (IHttpClientFactory httpClientFactory) =>
{
    if (!updateChecksEnabled)
    {
        return Results.Ok(new UpdateStatusPayload(
            Enabled: false,
            CurrentVersion: GarageLogVersion,
            LatestVersion: null,
            UpdateAvailable: false,
            ReleaseName: null,
            ReleaseUrl: null,
            PublishedAtUtc: null,
            CheckedAtUtc: DateTimeOffset.UtcNow,
            Error: null));
    }

    var now = DateTimeOffset.UtcNow;
    if (updateCache is not null && updateCache.ExpiresUtc > now) return Results.Ok(updateCache.Payload);

    await updateCacheGate.WaitAsync();
    try
    {
        now = DateTimeOffset.UtcNow;
        if (updateCache is not null && updateCache.ExpiresUtc > now) return Results.Ok(updateCache.Payload);

        var client = httpClientFactory.CreateClient("GarageLogUpdates");
        using var response = await client.GetAsync($"repos/{updateRepository}/releases/latest");
        response.EnsureSuccessStatusCode();
        using var releaseDocument = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var release = releaseDocument.RootElement;
        var tagName = release.TryGetProperty("tag_name", out var tagElement) ? tagElement.GetString() : null;
        var latestVersionValue = ParseReleaseVersion(tagName);
        var currentVersionValue = ParseReleaseVersion(GarageLogVersion);
        var releaseUrl = release.TryGetProperty("html_url", out var urlElement) ? urlElement.GetString() : null;
        if (!Uri.TryCreate(releaseUrl, UriKind.Absolute, out var releaseUri)
            || !string.Equals(releaseUri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(releaseUri.Host, "github.com", StringComparison.OrdinalIgnoreCase))
            releaseUrl = $"https://github.com/{updateRepository}/releases";
        var releaseName = release.TryGetProperty("name", out var nameElement) ? nameElement.GetString() : null;
        var publishedAt = release.TryGetProperty("published_at", out var publishedElement)
            && DateTimeOffset.TryParse(publishedElement.GetString(), out var publishedValue)
                ? publishedValue
                : (DateTimeOffset?)null;
        var payload = new UpdateStatusPayload(
            Enabled: true,
            CurrentVersion: GarageLogVersion,
            LatestVersion: latestVersionValue?.ToString(3) ?? tagName?.TrimStart('v', 'V'),
            UpdateAvailable: latestVersionValue is not null && currentVersionValue is not null && latestVersionValue > currentVersionValue,
            ReleaseName: string.IsNullOrWhiteSpace(releaseName) ? null : releaseName,
            ReleaseUrl: releaseUrl,
            PublishedAtUtc: publishedAt,
            CheckedAtUtc: now,
            Error: null);
        updateCache = new UpdateCacheEntry(now.AddHours(updateCheckHours), payload);
        return Results.Ok(payload);
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning(ex, "The GarageLog GitHub release check failed.");
        var payload = new UpdateStatusPayload(
            Enabled: true,
            CurrentVersion: GarageLogVersion,
            LatestVersion: null,
            UpdateAvailable: false,
            ReleaseName: null,
            ReleaseUrl: $"https://github.com/{updateRepository}/releases",
            PublishedAtUtc: null,
            CheckedAtUtc: now,
            Error: "The update check is temporarily unavailable.");
        updateCache = new UpdateCacheEntry(now.AddMinutes(30), payload);
        return Results.Ok(payload);
    }
    finally
    {
        updateCacheGate.Release();
    }
}).RequireAuthorization("Administrator");

app.MapGet("/diagnostics", () => Results.Content($$"""
<!doctype html><html><head><meta charset="utf-8"><title>GarageLog Diagnostics</title><link rel="icon" type="image/png" href="/assets/favicon-32x32.png">
<style>body{font-family:Segoe UI,Arial;margin:40px;line-height:1.5}code,pre{background:#f3f4f6;padding:4px 7px;border-radius:5px}a{color:#2563eb}</style></head>
<body><h1>GarageLog Diagnostics</h1><p><strong>Server:</strong> running</p><p><strong>Version:</strong> {{GarageLogVersion}}</p><p><strong>Data storage:</strong> configured</p>
<p><a href="/api/health">Test health API</a></p><p><a href="/api/state">Test data API</a></p><p><a href="/">Return to GarageLog</a></p></body></html>
""", "text/html; charset=utf-8")).RequireAuthorization("Administrator");

app.MapGet("/api/state", async (HttpContext context) =>
{
    var user = CurrentUser(context);
    if (user is null) return Results.Unauthorized();
    var json = await ReadStateAsync(connectionString);
    return Results.Text(FilterStateForUser(json, user), "application/json");
});

app.MapPut("/api/state", async (JsonElement state, HttpContext context) =>
{
    var user = CurrentUser(context);
    if (user is null) return Results.Unauthorized();
    if (!CanWrite(user)) return Results.Json(new { error = "This account has read-only access." }, statusCode: StatusCodes.Status403Forbidden);
    if (state.ValueKind != JsonValueKind.Object)
        return Results.BadRequest(new { error = "GarageLog state must be a JSON object." });
    if (!state.TryGetProperty("mileage", out var mileage)
        || mileage.ValueKind != JsonValueKind.Number
        || !mileage.TryGetInt32(out var mileageValue)
        || mileageValue < 0)
        return Results.BadRequest(new { error = "A valid non-negative mileage value is required." });
    var fullState = await ReadStateAsync(connectionString);
    var normalized = MergeStateForUser(fullState, state, user);
    await WriteStateAsync(connectionString, normalized);
    return Results.Ok(new { saved = true, mileage = mileageValue, savedAtUtc = DateTimeOffset.UtcNow });
});


app.MapPost("/api/vehicle-image", async (HttpRequest request, HttpContext context) =>
{
    var user = CurrentUser(context);
    if (user is null) return Results.Unauthorized();
    if (!request.HasFormContentType)
    {
        return Results.BadRequest(new { error = "A multipart image upload is required." });
    }

    var form = await request.ReadFormAsync();
    var file = form.Files.GetFile("file");
    if (file is null || file.Length == 0)
    {
        return Results.BadRequest(new { error = "Choose a non-empty vehicle image." });
    }

    const long maximumBytes = 15L * 1024L * 1024L;
    if (file.Length > maximumBytes)
    {
        return Results.BadRequest(new { error = "Vehicle images larger than 15 MB are not supported." });
    }

    var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
    var allowedExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { ".jpg", ".jpeg", ".png", ".webp" };
    if (!allowedExtensions.Contains(extension))
    {
        return Results.BadRequest(new { error = "Vehicle images must be JPG, PNG, or WEBP." });
    }

    var storedName = $"{Guid.NewGuid():N}{extension}";
    var destination = Path.Combine(vehiclesDirectory, storedName);
    await using (var output = File.Create(destination))
    {
        await file.CopyToAsync(output);
    }

    var previousStoredName = Path.GetFileName(form["previousStoredName"].ToString());
    if (!string.IsNullOrWhiteSpace(previousStoredName))
    {
        if (!await CanAccessVehicleImageAsync(connectionString, user, previousStoredName))
        {
            if (File.Exists(destination)) File.Delete(destination);
            return Results.NotFound(new { error = "The existing vehicle image is not available to this account." });
        }
        var previousPath = Path.Combine(vehiclesDirectory, previousStoredName);
        if (File.Exists(previousPath) && !string.Equals(previousPath, destination, StringComparison.OrdinalIgnoreCase))
        {
            File.Delete(previousPath);
        }
    }

    return Results.Ok(new { storedName, originalName = Path.GetFileName(file.FileName), size = file.Length });
});

app.MapGet("/api/vehicle-image/{storedName}", async (string storedName, HttpContext context) =>
{
    var user = CurrentUser(context);
    if (user is null) return Results.Unauthorized();
    var safeName = Path.GetFileName(storedName);
    if (!await CanAccessVehicleImageAsync(connectionString, user, safeName)) return Results.NotFound();
    var path = Path.Combine(vehiclesDirectory, safeName);
    if (!File.Exists(path))
    {
        return Results.NotFound();
    }

    var contentType = Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".png" => "image/png",
        ".webp" => "image/webp",
        ".jpg" or ".jpeg" => "image/jpeg",
        _ => "application/octet-stream"
    };
    return Results.File(path, contentType, enableRangeProcessing: true);
});

app.MapDelete("/api/vehicle-image/{storedName}", async (string storedName, HttpContext context) =>
{
    var user = CurrentUser(context);
    if (user is null) return Results.Unauthorized();
    var safeName = Path.GetFileName(storedName);
    if (!await CanAccessVehicleImageAsync(connectionString, user, safeName)) return Results.NotFound();
    var path = Path.Combine(vehiclesDirectory, safeName);
    if (File.Exists(path))
    {
        File.Delete(path);
    }
    return Results.NoContent();
});

app.MapPost("/api/documents", async (HttpRequest request) =>
{
    if (!request.HasFormContentType) return Results.BadRequest(new { error = "A multipart file upload is required." });
    var form = await request.ReadFormAsync();
    var file = form.Files.GetFile("file");
    if (file is null || file.Length == 0) return Results.BadRequest(new { error = "Choose a non-empty file." });
    const long maximumBytes = 100L * 1024L * 1024L;
    if (file.Length > maximumBytes) return Results.BadRequest(new { error = "Files larger than 100 MB are not supported." });
    var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
    if (!IsAllowedDocumentExtension(extension))
        return Results.BadRequest(new { error = "That file type is not supported by GarageLog." });
    await using var input = file.OpenReadStream();
    if (extension is ".jpg" or ".jpeg" or ".png" or ".webp" or ".gif" or ".tif" or ".tiff"
        && !await HasExpectedImageSignatureAsync(input, extension))
        return Results.BadRequest(new { error = "The selected file does not contain a valid supported image." });
    if (extension == ".pdf" && !await HasExpectedPdfSignatureAsync(input))
        return Results.BadRequest(new { error = "The selected file does not contain a valid PDF header." });
    input.Position = 0;
    var storedName = $"{Guid.NewGuid():N}{extension}";
    var destination = Path.Combine(documentsDirectory, storedName);
    await using (var output = File.Create(destination)) await input.CopyToAsync(output);
    return Results.Ok(new { storedName, originalName = Path.GetFileName(file.FileName), extension, contentType = GetDocumentContentType(file.FileName), size = file.Length });
});

app.MapGet("/api/documents/ocr-status", () => Results.Ok(new
{
    managedPdfText = true,
    pdfText = CommandExists("pdftotext"),
    pdfImages = CommandExists("pdftoppm"),
    imageOcr = CommandExists("tesseract"),
    scannedPdfOcr = CommandExists("pdftoppm") && CommandExists("tesseract"),
    officePreview = CommandExists("soffice") || CommandExists("libreoffice"),
    qr = CommandExists("qrencode"),
    platform = OperatingSystem.IsWindows() ? "windows" : OperatingSystem.IsLinux() ? "linux" : OperatingSystem.IsMacOS() ? "macos" : "other",
    setupScript = (string?)null
}));

app.MapGet("/api/documents/{storedName}", async (string storedName, HttpContext context) =>
{
    var user = CurrentUser(context);
    if (user is null) return Results.Unauthorized();
    var safeName = Path.GetFileName(storedName);
    if (!await CanAccessDocumentAsync(connectionString, user, safeName)) return Results.NotFound();
    var path = Path.Combine(documentsDirectory, safeName);
    if (!File.Exists(path)) return Results.NotFound();
    return Results.File(path, GetDocumentContentType(path), enableRangeProcessing: true);
});

app.MapGet("/api/documents/{storedName}/preview", async (string storedName, HttpContext context) =>
{
    var user = CurrentUser(context);
    if (user is null) return Results.Unauthorized();
    var safeName = Path.GetFileName(storedName);
    if (!await CanAccessDocumentAsync(connectionString, user, safeName)) return Results.NotFound();
    var path = Path.Combine(documentsDirectory, safeName);
    if (!File.Exists(path)) return Results.NotFound();
    var extension = Path.GetExtension(path).ToLowerInvariant();
    if (extension is ".pdf" or ".png" or ".jpg" or ".jpeg" or ".webp" or ".gif" or ".txt" or ".csv" or ".md")
        return Results.File(path, GetDocumentContentType(path), enableRangeProcessing: true);
    if (extension is ".doc" or ".docx" or ".xls" or ".xlsx" or ".ppt" or ".pptx" or ".odt" or ".ods")
    {
        var converted = await ConvertOfficeDocumentToPdfAsync(path, documentPreviewDirectory);
        if (converted is null || !File.Exists(converted)) return Results.Problem("Office preview requires LibreOffice on the GarageLog host.", statusCode: 415);
        return Results.File(converted, "application/pdf", enableRangeProcessing: true);
    }
    return Results.File(path, GetDocumentContentType(path), enableRangeProcessing: true);
});

app.MapPost("/api/documents/{storedName}/extract-text", async (string storedName, HttpContext context) =>
{
    var user = CurrentUser(context);
    if (user is null) return Results.Unauthorized();
    var safeName = Path.GetFileName(storedName);
    if (!await CanAccessDocumentAsync(connectionString, user, safeName)) return Results.NotFound();
    var path = Path.Combine(documentsDirectory, safeName);
    if (!File.Exists(path)) return Results.NotFound(new { error = "The stored document was not found." });
    try
    {
        var extracted = await ExtractDocumentTextAsync(path);
        return Results.Ok(new { text = extracted.Text, method = extracted.Method, characters = extracted.Text.Length, indexedAtUtc = DateTimeOffset.UtcNow });
    }
    catch (DocumentOcrRequiredException ex) { return Results.Json(new { error = ex.Message, ocrRequired = true, missingTools = ex.MissingTools }, statusCode: 422); }
    catch (DocumentToolUnavailableException ex) { return Results.Json(new { error = ex.Message, toolUnavailable = true }, statusCode: 503); }
    catch (Exception ex) { return Results.Json(new { error = $"Text extraction failed: {ex.Message}" }, statusCode: 500); }
});

app.MapPost("/api/documents/export", async (DocumentExportRequest request, HttpContext context) =>
{
    var safeNames = (request.StoredNames ?? Array.Empty<string>())
        .Select(Path.GetFileName)
        .Where(x => !string.IsNullOrWhiteSpace(x))
        .Select(x => x!)
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToArray();
    if (safeNames.Length == 0) return Results.BadRequest(new { error = "Select at least one document to export." });
    var user = CurrentUser(context);
    if (user is null) return Results.Unauthorized();
    foreach (var safeName in safeNames)
        if (!await CanAccessDocumentAsync(connectionString, user, safeName)) return Results.NotFound(new { error = "One or more selected documents are unavailable." });
    await using var output = new MemoryStream();
    using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
    {
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var safeName in safeNames)
        {
            var source = Path.Combine(documentsDirectory, safeName);
            if (!File.Exists(source)) continue;
            var requestedName = request.FileNames is not null && request.FileNames.TryGetValue(safeName, out var display) ? Path.GetFileName(display) : safeName;
            var entry = archive.CreateEntry(MakeUniqueArchiveName(string.IsNullOrWhiteSpace(requestedName) ? safeName : requestedName, used), CompressionLevel.Optimal);
            await using var entryStream = entry.Open();
            await using var sourceStream = File.OpenRead(source);
            await sourceStream.CopyToAsync(entryStream);
        }
    }
    return Results.File(output.ToArray(), "application/zip", $"garagelog-documents-{DateTime.Now:yyyyMMdd-HHmm}.zip");
});

app.MapGet("/api/qr", async (string text) =>
{
    if (string.IsNullOrWhiteSpace(text) || text.Length > 2048) return Results.BadRequest(new { error = "A share link is required." });
    if (!CommandExists("qrencode")) return Results.Json(new { error = "QR generation requires qrencode on the GarageLog host." }, statusCode: 503);
    var result = await RunProcessAsync("qrencode", new[] { "-t", "SVG", "-o", "-", "--", text }, 30);
    if (result.ExitCode != 0 || string.IsNullOrWhiteSpace(result.StandardOutput)) return Results.Json(new { error = "Unable to generate the QR code." }, statusCode: 500);
    return Results.Text(result.StandardOutput, "image/svg+xml");
});

app.MapGet("/shared/{token}", async (string token, HttpContext context) =>
{
    if (!Regex.IsMatch(token, "^[A-Za-z0-9_-]{16,128}$")) return Results.NotFound();
    using var stateDocument = JsonDocument.Parse(await ReadStateAsync(connectionString));
    if (!stateDocument.RootElement.TryGetProperty("documents", out var docs) || docs.ValueKind != JsonValueKind.Array) return Results.NotFound();
    foreach (var doc in docs.EnumerateArray())
    {
        if (!doc.TryGetProperty("shareToken", out var tokenElement) || tokenElement.GetString() != token) continue;
        if (doc.TryGetProperty("shareEnabled", out var enabled) && enabled.ValueKind == JsonValueKind.False) return Results.NotFound();
        if (!doc.TryGetProperty("storedName", out var storedElement)) return Results.NotFound();
        var storedName = storedElement.GetString();
        if (string.IsNullOrWhiteSpace(storedName)) return Results.NotFound();
        var safeName = Path.GetFileName(storedName);
        var path = Path.Combine(documentsDirectory, safeName);
        if (!File.Exists(path)) return Results.NotFound();
        context.Response.Headers.CacheControl = "no-store, private";
        context.Response.Headers["X-Robots-Tag"] = "noindex, nofollow, noarchive";
        return Results.File(path, GetDocumentContentType(path), enableRangeProcessing: true);
    }
    return Results.NotFound();
}).AllowAnonymous();

app.MapDelete("/api/documents/{storedName}", async (string storedName, HttpContext context) =>
{
    var user = CurrentUser(context);
    if (user is null) return Results.Unauthorized();
    var safeName = Path.GetFileName(storedName);
    if (!await CanAccessDocumentAsync(connectionString, user, safeName)) return Results.NotFound();
    var path = Path.Combine(documentsDirectory, safeName);
    if (File.Exists(path)) File.Delete(path);
    foreach (var preview in Directory.EnumerateFiles(documentPreviewDirectory, $"{Path.GetFileNameWithoutExtension(safeName)}.*")) File.Delete(preview);
    return Results.NoContent();
});


app.MapFallbackToFile("index.html").AllowAnonymous();

app.Logger.LogInformation("GarageLog {Version} is running.", GarageLogVersion);
app.Logger.LogInformation("GarageLog local data storage is configured.");

app.Run();

static void CopyDirectoryContents(string sourceDirectory, string destinationDirectory)
{
    Directory.CreateDirectory(destinationDirectory);
    foreach (var file in Directory.EnumerateFiles(sourceDirectory, "*", SearchOption.AllDirectories))
    {
        var relativePath = Path.GetRelativePath(sourceDirectory, file);
        var destination = Path.Combine(destinationDirectory, relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(destination) ?? destinationDirectory);

        // Release archives contain placeholder files such as .gitkeep in the
        // destination data folders. Skip any destination file that already
        // exists so legacy data migration can continue without failing on a
        // harmless placeholder. The database itself is only migrated when the
        // new data directory does not already contain one.
        if (File.Exists(destination))
        {
            continue;
        }

        File.Copy(file, destination, overwrite: false);
    }
}

static async Task InitializeDatabaseAsync(string connectionString)
{
    await using var connection = new SqliteConnection(connectionString);
    await connection.OpenAsync();

    await using var command = connection.CreateCommand();
    command.CommandText = """
        CREATE TABLE IF NOT EXISTS AppState (
            Id INTEGER PRIMARY KEY CHECK (Id = 1),
            Json TEXT NOT NULL,
            UpdatedUtc TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS Users (
            Id TEXT PRIMARY KEY,
            Username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            DisplayName TEXT NOT NULL,
            PasswordHash TEXT NOT NULL,
            Role TEXT NOT NULL,
            AccessLevel TEXT NOT NULL,
            VisibilityScope TEXT NOT NULL,
            AssignedVehicleIdsJson TEXT NOT NULL DEFAULT '[]',
            ProfileImageStoredName TEXT NULL,
            IsActive INTEGER NOT NULL DEFAULT 1,
            SecurityStamp TEXT NOT NULL,
            CreatedUtc TEXT NOT NULL,
            UpdatedUtc TEXT NOT NULL,
            LastLoginUtc TEXT NULL
        );

        INSERT INTO AppState (Id, Json, UpdatedUtc)
        SELECT 1, $seed, $updatedUtc
        WHERE NOT EXISTS (SELECT 1 FROM AppState WHERE Id = 1);
        """;
    command.Parameters.AddWithValue("$seed", GarageLogSeed.Json);
    command.Parameters.AddWithValue("$updatedUtc", DateTimeOffset.UtcNow.ToString("O"));
    await command.ExecuteNonQueryAsync();
}

static async Task<string> ReadStateAsync(string connectionString)
{
    await using var connection = new SqliteConnection(connectionString);
    await connection.OpenAsync();

    await using var command = connection.CreateCommand();
    command.CommandText = "SELECT Json FROM AppState WHERE Id = 1;";
    var result = await command.ExecuteScalarAsync();
    return result as string ?? GarageLogSeed.Json;
}

static async Task WriteStateAsync(string connectionString, string json)
{
    await using var connection = new SqliteConnection(connectionString);
    await connection.OpenAsync();

    await using var transaction = await connection.BeginTransactionAsync();
    await using var command = connection.CreateCommand();
    command.Transaction = (SqliteTransaction)transaction;
    command.CommandText = """
        INSERT INTO AppState (Id, Json, UpdatedUtc)
        VALUES (1, $json, $updatedUtc)
        ON CONFLICT(Id) DO UPDATE SET
            Json = excluded.Json,
            UpdatedUtc = excluded.UpdatedUtc;
        """;
    command.Parameters.AddWithValue("$json", json);
    command.Parameters.AddWithValue("$updatedUtc", DateTimeOffset.UtcNow.ToString("O"));
    await command.ExecuteNonQueryAsync();
    await transaction.CommitAsync();
}


static GarageLogUser? CurrentUser(HttpContext context) => context.Items.TryGetValue(GarageLogAuthConstants.CurrentUserItemKey, out var value) ? value as GarageLogUser : null;
static bool IsAdministrator(GarageLogUser user) => string.Equals(user.Role, UserRoles.Administrator, StringComparison.Ordinal);
static bool CanWrite(GarageLogUser user) => IsAdministrator(user) || string.Equals(user.AccessLevel, AccessLevels.ReadWrite, StringComparison.Ordinal);
static bool CanViewAllVehicles(GarageLogUser user) => IsAdministrator(user) || string.Equals(user.VisibilityScope, VisibilityScopes.AllVehicles, StringComparison.Ordinal);
static HashSet<string> AssignedVehicleIds(GarageLogUser user)
{
    try { return JsonSerializer.Deserialize<string[]>(user.AssignedVehicleIdsJson)?.Select(x => x).Where(x => !string.IsNullOrWhiteSpace(x)).ToHashSet(StringComparer.Ordinal) ?? new(StringComparer.Ordinal); }
    catch { return new(StringComparer.Ordinal); }
}
static bool CanUseUnsafeEndpoint(GarageLogUser user, PathString path)
{
    if (CanWrite(user)) return true;
    if (path.StartsWithSegments("/api/profile") || path.StartsWithSegments("/api/auth/logout")) return true;
    if (path.StartsWithSegments("/api/documents/export") || path.StartsWithSegments("/api/qr")) return true;
    if (path.Value?.EndsWith("/extract-text", StringComparison.OrdinalIgnoreCase) == true) return true;
    return false;
}
static async Task<bool> HasExpectedImageSignatureAsync(Stream stream, string extension)
{
    if (!stream.CanSeek) return false;
    var header = new byte[12];
    var read = await stream.ReadAsync(header.AsMemory(0, header.Length));
    stream.Position = 0;
    if (extension == ".png") return read >= 8 && header.AsSpan(0, 8).SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A });
    if (extension is ".jpg" or ".jpeg") return read >= 3 && header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF;
    if (extension == ".webp") return read >= 12 && Encoding.ASCII.GetString(header, 0, 4) == "RIFF" && Encoding.ASCII.GetString(header, 8, 4) == "WEBP";
    if (extension == ".gif") return read >= 6 && (Encoding.ASCII.GetString(header, 0, 6) == "GIF87a" || Encoding.ASCII.GetString(header, 0, 6) == "GIF89a");
    if (extension is ".tif" or ".tiff") return read >= 4 && ((header[0] == 0x49 && header[1] == 0x49 && header[2] == 0x2A && header[3] == 0x00) || (header[0] == 0x4D && header[1] == 0x4D && header[2] == 0x00 && header[3] == 0x2A));
    return false;
}
static string GetImageContentType(string fileName) => Path.GetExtension(fileName).ToLowerInvariant() switch
{
    ".png" => "image/png", ".webp" => "image/webp", ".jpg" or ".jpeg" => "image/jpeg", _ => "application/octet-stream"
};
static object ToUserDto(GarageLogUser user) => new
{
    id = user.Id,
    username = user.Username,
    displayName = user.DisplayName,
    role = user.Role,
    accessLevel = user.AccessLevel,
    visibilityScope = user.VisibilityScope,
    assignedVehicleIds = AssignedVehicleIds(user).ToArray(),
    profileImageStoredName = user.ProfileImageStoredName,
    profileImageUrl = string.IsNullOrWhiteSpace(user.ProfileImageStoredName) ? null : $"/api/profile/image/{Uri.EscapeDataString(user.ProfileImageStoredName)}",
    isActive = user.IsActive,
    createdUtc = user.CreatedUtc,
    updatedUtc = user.UpdatedUtc,
    lastLoginUtc = user.LastLoginUtc,
    permissions = new { canWrite = CanWrite(user), canManageUsers = IsAdministrator(user), canViewAllVehicles = CanViewAllVehicles(user) }
};
static ClaimsPrincipal CreatePrincipal(GarageLogUser user)
{
    var claims = new List<Claim>
    {
        new(ClaimTypes.NameIdentifier, user.Id),
        new(ClaimTypes.Name, user.Username),
        new(ClaimTypes.Role, user.Role),
        new("garagelog:access", user.AccessLevel),
        new("garagelog:visibility", user.VisibilityScope),
        new("garagelog:security_stamp", user.SecurityStamp)
    };
    return new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme));
}
static Task SignInUserAsync(HttpContext context, GarageLogUser user, bool rememberMe) => context.SignInAsync(
    CookieAuthenticationDefaults.AuthenticationScheme,
    CreatePrincipal(user),
    new AuthenticationProperties
    {
        IsPersistent = rememberMe,
        AllowRefresh = true,
        ExpiresUtc = DateTimeOffset.UtcNow.Add(rememberMe ? TimeSpan.FromDays(14) : TimeSpan.FromHours(12))
    });
static string? ValidateUsernameAndDisplayName(string username, string displayName)
{
    username = username?.Trim() ?? string.Empty;
    displayName = displayName?.Trim() ?? string.Empty;
    if (!Regex.IsMatch(username, "^[A-Za-z0-9._-]{3,40}$")) return "Username must be 3–40 characters and use only letters, numbers, periods, underscores, or hyphens.";
    if (displayName.Length < 1 || displayName.Length > 80) return "Display name must be between 1 and 80 characters.";
    return null;
}
static string? ValidatePassword(string password)
{
    if (string.IsNullOrEmpty(password) || password.Length < 12) return "Password must be at least 12 characters.";
    if (password.Length > 128) return "Password must be 128 characters or fewer.";
    return null;
}
static string? ValidateNewCredentials(string username, string displayName, string password) => ValidateUsernameAndDisplayName(username, displayName) ?? ValidatePassword(password);
static string NormalizeRole(string? role) => string.Equals(role, UserRoles.Administrator, StringComparison.OrdinalIgnoreCase) ? UserRoles.Administrator : UserRoles.User;
static string NormalizeAccess(string? access) => string.Equals(access, AccessLevels.ReadOnly, StringComparison.OrdinalIgnoreCase) ? AccessLevels.ReadOnly : AccessLevels.ReadWrite;
static string NormalizeVisibility(string? visibility) => string.Equals(visibility, VisibilityScopes.SelectedVehicles, StringComparison.OrdinalIgnoreCase) ? VisibilityScopes.SelectedVehicles : VisibilityScopes.AllVehicles;
static string NormalizeAssignedVehicleIds(IEnumerable<string>? ids) => JsonSerializer.Serialize((ids ?? Array.Empty<string>()).Select(x => x).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct(StringComparer.Ordinal).ToArray());
static async Task<string?> ValidateManagedAccessAsync(string connectionString, string? role, string? visibility, IEnumerable<string>? assignedVehicleIds)
{
    if (NormalizeRole(role) == UserRoles.Administrator || NormalizeVisibility(visibility) == VisibilityScopes.AllVehicles) return null;
    var assigned = (assignedVehicleIds ?? Array.Empty<string>()).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct(StringComparer.Ordinal).ToArray();
    if (assigned.Length == 0) return "Assign at least one visible vehicle to a selected-vehicle user.";
    using var document = JsonDocument.Parse(await ReadStateAsync(connectionString));
    var valid = new HashSet<string>(StringComparer.Ordinal);
    if (document.RootElement.TryGetProperty("vehicles", out var vehicles) && vehicles.ValueKind == JsonValueKind.Array)
        foreach (var vehicle in vehicles.EnumerateArray()) if (vehicle.TryGetProperty("id", out var id) && !string.IsNullOrWhiteSpace(id.GetString())) valid.Add(id.GetString()!);
    if (assigned.Any(id => !valid.Contains(id))) return "One or more assigned vehicles no longer exist.";
    return null;
}
static GarageLogUser CreateManagedUser(string username, string displayName, string? role, string? access, string? visibility, IEnumerable<string>? assignedVehicleIds, bool active)
{
    var now = DateTimeOffset.UtcNow;
    var user = new GarageLogUser
    {
        Id = Guid.NewGuid().ToString("N"), Username = username.Trim(), DisplayName = displayName.Trim(), PasswordHash = string.Empty,
        SecurityStamp = Guid.NewGuid().ToString("N"), CreatedUtc = now, UpdatedUtc = now
    };
    ApplyManagedAccess(user, role, access, visibility, assignedVehicleIds, active);
    return user;
}
static void ApplyManagedAccess(GarageLogUser user, string? role, string? access, string? visibility, IEnumerable<string>? assignedVehicleIds, bool active)
{
    user.Role = NormalizeRole(role);
    user.IsActive = active;
    if (IsAdministrator(user))
    {
        user.AccessLevel = AccessLevels.ReadWrite;
        user.VisibilityScope = VisibilityScopes.AllVehicles;
        user.AssignedVehicleIdsJson = "[]";
    }
    else
    {
        user.AccessLevel = NormalizeAccess(access);
        user.VisibilityScope = NormalizeVisibility(visibility);
        user.AssignedVehicleIdsJson = user.VisibilityScope == VisibilityScopes.SelectedVehicles ? NormalizeAssignedVehicleIds(assignedVehicleIds) : "[]";
    }
}
static async Task<int> CountUsersAsync(string connectionString)
{
    await using var connection = new SqliteConnection(connectionString); await connection.OpenAsync();
    await using var command = connection.CreateCommand(); command.CommandText = "SELECT COUNT(*) FROM Users;";
    return Convert.ToInt32(await command.ExecuteScalarAsync());
}
static async Task<int> CountActiveAdministratorsAsync(string connectionString)
{
    await using var connection = new SqliteConnection(connectionString); await connection.OpenAsync();
    await using var command = connection.CreateCommand(); command.CommandText = "SELECT COUNT(*) FROM Users WHERE IsActive = 1 AND Role = $role;"; command.Parameters.AddWithValue("$role", UserRoles.Administrator);
    return Convert.ToInt32(await command.ExecuteScalarAsync());
}
static GarageLogUser ReadUser(SqliteDataReader reader) => new()
{
    Id = reader.GetString(0), Username = reader.GetString(1), DisplayName = reader.GetString(2), PasswordHash = reader.GetString(3),
    Role = reader.GetString(4), AccessLevel = reader.GetString(5), VisibilityScope = reader.GetString(6), AssignedVehicleIdsJson = reader.GetString(7),
    ProfileImageStoredName = reader.IsDBNull(8) ? null : reader.GetString(8), IsActive = reader.GetInt32(9) == 1, SecurityStamp = reader.GetString(10),
    CreatedUtc = DateTimeOffset.Parse(reader.GetString(11)), UpdatedUtc = DateTimeOffset.Parse(reader.GetString(12)), LastLoginUtc = reader.IsDBNull(13) ? null : DateTimeOffset.Parse(reader.GetString(13))
};
static async Task<GarageLogUser?> ReadUserByIdAsync(string connectionString, string id)
{
    await using var connection = new SqliteConnection(connectionString); await connection.OpenAsync();
    await using var command = connection.CreateCommand(); command.CommandText = $"SELECT {GarageLogAuthConstants.UserSelectColumns} FROM Users WHERE Id = $id LIMIT 1;"; command.Parameters.AddWithValue("$id", id);
    await using var reader = await command.ExecuteReaderAsync(); return await reader.ReadAsync() ? ReadUser(reader) : null;
}
static async Task<GarageLogUser?> ReadUserByUsernameAsync(string connectionString, string username)
{
    await using var connection = new SqliteConnection(connectionString); await connection.OpenAsync();
    await using var command = connection.CreateCommand(); command.CommandText = $"SELECT {GarageLogAuthConstants.UserSelectColumns} FROM Users WHERE Username = $username COLLATE NOCASE LIMIT 1;"; command.Parameters.AddWithValue("$username", username);
    await using var reader = await command.ExecuteReaderAsync(); return await reader.ReadAsync() ? ReadUser(reader) : null;
}
static async Task<List<GarageLogUser>> ReadUsersAsync(string connectionString)
{
    var users = new List<GarageLogUser>(); await using var connection = new SqliteConnection(connectionString); await connection.OpenAsync();
    await using var command = connection.CreateCommand(); command.CommandText = $"SELECT {GarageLogAuthConstants.UserSelectColumns} FROM Users ORDER BY Role DESC, DisplayName COLLATE NOCASE;";
    await using var reader = await command.ExecuteReaderAsync(); while (await reader.ReadAsync()) users.Add(ReadUser(reader)); return users;
}
static async Task SaveUserAsync(string connectionString, GarageLogUser user)
{
    await using var connection = new SqliteConnection(connectionString); await connection.OpenAsync();
    await using var command = connection.CreateCommand(); command.CommandText = """
        INSERT INTO Users (Id, Username, DisplayName, PasswordHash, Role, AccessLevel, VisibilityScope, AssignedVehicleIdsJson, ProfileImageStoredName, IsActive, SecurityStamp, CreatedUtc, UpdatedUtc, LastLoginUtc)
        VALUES ($id, $username, $displayName, $passwordHash, $role, $access, $visibility, $assigned, $image, $active, $stamp, $created, $updated, $lastLogin)
        ON CONFLICT(Id) DO UPDATE SET Username=excluded.Username, DisplayName=excluded.DisplayName, PasswordHash=excluded.PasswordHash,
            Role=excluded.Role, AccessLevel=excluded.AccessLevel, VisibilityScope=excluded.VisibilityScope, AssignedVehicleIdsJson=excluded.AssignedVehicleIdsJson,
            ProfileImageStoredName=excluded.ProfileImageStoredName, IsActive=excluded.IsActive, SecurityStamp=excluded.SecurityStamp,
            UpdatedUtc=excluded.UpdatedUtc, LastLoginUtc=excluded.LastLoginUtc;
        """;
    command.Parameters.AddWithValue("$id", user.Id); command.Parameters.AddWithValue("$username", user.Username); command.Parameters.AddWithValue("$displayName", user.DisplayName);
    command.Parameters.AddWithValue("$passwordHash", user.PasswordHash); command.Parameters.AddWithValue("$role", user.Role); command.Parameters.AddWithValue("$access", user.AccessLevel);
    command.Parameters.AddWithValue("$visibility", user.VisibilityScope); command.Parameters.AddWithValue("$assigned", user.AssignedVehicleIdsJson);
    command.Parameters.AddWithValue("$image", (object?)user.ProfileImageStoredName ?? DBNull.Value); command.Parameters.AddWithValue("$active", user.IsActive ? 1 : 0);
    command.Parameters.AddWithValue("$stamp", user.SecurityStamp); command.Parameters.AddWithValue("$created", user.CreatedUtc.ToString("O")); command.Parameters.AddWithValue("$updated", user.UpdatedUtc.ToString("O"));
    command.Parameters.AddWithValue("$lastLogin", user.LastLoginUtc is null ? (object)DBNull.Value : user.LastLoginUtc.Value.ToString("O")); await command.ExecuteNonQueryAsync();
}
static bool NodeBelongsToVehicles(JsonNode? node, HashSet<string> vehicleIds)
{
    if (node is not JsonObject obj || obj["vehicleId"] is null) return false;
    return vehicleIds.Contains(obj["vehicleId"]!.GetValue<string>());
}
static bool SavedReportOwnedBy(JsonNode? node, GarageLogUser user, HashSet<string>? allowedVehicles = null)
{
    if (node is not JsonObject report) return false;
    var ownerId = report["ownerUserId"]?.GetValue<string>() ?? string.Empty;
    if (!string.Equals(ownerId, user.Id, StringComparison.Ordinal)) return false;
    if (allowedVehicles is null) return true;
    var vehicleId = report["vehicleId"]?.GetValue<string>() ?? string.Empty;
    return allowedVehicles.Contains(vehicleId);
}
static JsonArray MergeSavedReports(JsonObject full, JsonObject submitted, GarageLogUser user, HashSet<string>? allowedVehicles = null)
{
    var merged = new JsonArray();
    foreach (var node in full["savedReports"] as JsonArray ?? new JsonArray())
        if (!SavedReportOwnedBy(node, user) && node is not null) merged.Add(node.DeepClone());
    foreach (var node in submitted["savedReports"] as JsonArray ?? new JsonArray())
        if (SavedReportOwnedBy(node, user, allowedVehicles) && node is not null) merged.Add(node.DeepClone());
    return merged;
}
static string FilterStateForUser(string json, GarageLogUser user)
{
    if (IsAdministrator(user)) return json;
    var root = JsonNode.Parse(json)?.AsObject() ?? new JsonObject();
    var allowed = CanViewAllVehicles(user)
        ? (root["vehicles"] as JsonArray ?? new JsonArray()).OfType<JsonObject>().Select(vehicle => vehicle["id"]?.GetValue<string>()).Where(id => !string.IsNullOrWhiteSpace(id)).Select(id => id!).ToHashSet(StringComparer.Ordinal)
        : AssignedVehicleIds(user);
    if (!CanViewAllVehicles(user))
    {
        var vehicles = root["vehicles"] as JsonArray ?? new JsonArray();
        var visibleVehicles = new JsonArray();
        foreach (var node in vehicles) if (node is JsonObject vehicle && vehicle["id"] is not null && allowed.Contains(vehicle["id"]!.GetValue<string>())) visibleVehicles.Add(node.DeepClone());
        root["vehicles"] = visibleVehicles;
        foreach (var name in new[] { "maintenance", "expenses", "documents", "reminders" })
        {
            var source = root[name] as JsonArray ?? new JsonArray(); var filtered = new JsonArray();
            foreach (var node in source) if (NodeBelongsToVehicles(node, allowed)) filtered.Add(node!.DeepClone());
            root[name] = filtered;
        }
        var activeId = root["activeVehicleId"]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(activeId) || !allowed.Contains(activeId)) activeId = visibleVehicles.OfType<JsonObject>().FirstOrDefault()?["id"]?.GetValue<string>();
        root["activeVehicleId"] = activeId;
        var active = visibleVehicles.FirstOrDefault(node => node?["id"]?.GetValue<string>() == activeId) as JsonObject;
        if (active is not null)
        {
            root["vehicle"] = active.DeepClone(); root["mileage"] = active["mileage"]?.DeepClone(); root["mileageHistory"] = active["mileageHistory"]?.DeepClone(); root["metrics"] = active["metrics"]?.DeepClone();
        }
        else
        {
            root["vehicle"] = null; root["mileage"] = 0; root["mileageHistory"] = new JsonArray(); root["metrics"] = new JsonObject();
        }
    }
    var saved = new JsonArray();
    foreach (var node in root["savedReports"] as JsonArray ?? new JsonArray()) if (SavedReportOwnedBy(node, user, allowed) && node is not null) saved.Add(node.DeepClone());
    root["savedReports"] = saved;
    return root.ToJsonString(new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true });
}
static string MergeStateForUser(string fullJson, JsonElement submittedElement, GarageLogUser user)
{
    var submittedText = JsonSerializer.Serialize(submittedElement, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true });
    if (IsAdministrator(user)) return submittedText;
    var full = JsonNode.Parse(fullJson)?.AsObject() ?? new JsonObject(); var submitted = JsonNode.Parse(submittedText)?.AsObject() ?? new JsonObject();
    if (CanViewAllVehicles(user))
    {
        var allowedAll = (full["vehicles"] as JsonArray ?? new JsonArray()).OfType<JsonObject>().Select(vehicle => vehicle["id"]?.GetValue<string>()).Where(id => !string.IsNullOrWhiteSpace(id)).Select(id => id!).ToHashSet(StringComparer.Ordinal);
        submitted["savedReports"] = MergeSavedReports(full, submitted, user, allowedAll);
        return submitted.ToJsonString(new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true });
    }
    var allowed = AssignedVehicleIds(user);
    foreach (var property in submitted)
    {
        if (property.Key is "vehicles" or "vehicle" or "activeVehicleId" or "maintenance" or "expenses" or "documents" or "reminders" or "mileage" or "mileageHistory" or "metrics" or "savedReports") continue;
        full[property.Key] = property.Value?.DeepClone();
    }
    full["savedReports"] = MergeSavedReports(full, submitted, user, allowed);
    var submittedVehicles = (submitted["vehicles"] as JsonArray ?? new JsonArray()).OfType<JsonObject>().Where(v => v["id"] is not null && allowed.Contains(v["id"]!.GetValue<string>())).ToDictionary(v => v["id"]!.GetValue<string>(), v => v, StringComparer.Ordinal);
    var mergedVehicles = new JsonArray();
    foreach (var node in full["vehicles"] as JsonArray ?? new JsonArray())
    {
        if (node is not JsonObject vehicle || vehicle["id"] is null) { if (node is not null) mergedVehicles.Add(node.DeepClone()); continue; }
        var id = vehicle["id"]!.GetValue<string>(); mergedVehicles.Add(allowed.Contains(id) && submittedVehicles.TryGetValue(id, out var updated) ? updated.DeepClone() : vehicle.DeepClone());
    }
    full["vehicles"] = mergedVehicles;
    foreach (var name in new[] { "maintenance", "expenses", "documents", "reminders" })
    {
        var merged = new JsonArray();
        foreach (var node in full[name] as JsonArray ?? new JsonArray()) if (!NodeBelongsToVehicles(node, allowed) && node is not null) merged.Add(node.DeepClone());
        foreach (var node in submitted[name] as JsonArray ?? new JsonArray()) if (NodeBelongsToVehicles(node, allowed) && node is not null) merged.Add(node.DeepClone());
        full[name] = merged;
    }
    var activeId = submitted["activeVehicleId"]?.GetValue<string>();
    if (string.IsNullOrWhiteSpace(activeId) || !allowed.Contains(activeId)) activeId = allowed.FirstOrDefault();
    full["activeVehicleId"] = activeId;
    var active = mergedVehicles.OfType<JsonObject>().FirstOrDefault(v => v["id"]?.GetValue<string>() == activeId);
    if (active is not null) { full["vehicle"] = active.DeepClone(); full["mileage"] = active["mileage"]?.DeepClone(); full["mileageHistory"] = active["mileageHistory"]?.DeepClone(); full["metrics"] = active["metrics"]?.DeepClone(); }
    return full.ToJsonString(new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true });
}
static async Task<bool> CanAccessDocumentAsync(string connectionString, GarageLogUser user, string storedName)
{
    if (CanViewAllVehicles(user)) return true; var allowed = AssignedVehicleIds(user); using var doc = JsonDocument.Parse(await ReadStateAsync(connectionString));
    if (!doc.RootElement.TryGetProperty("documents", out var documents) || documents.ValueKind != JsonValueKind.Array) return false;
    foreach (var item in documents.EnumerateArray())
        if (item.TryGetProperty("storedName", out var stored) && string.Equals(Path.GetFileName(stored.GetString()), storedName, StringComparison.OrdinalIgnoreCase)
            && item.TryGetProperty("vehicleId", out var vehicleId) && allowed.Contains(vehicleId.GetString() ?? string.Empty)) return true;
    return false;
}
static async Task<bool> CanAccessVehicleImageAsync(string connectionString, GarageLogUser user, string storedName)
{
    if (CanViewAllVehicles(user)) return true; var allowed = AssignedVehicleIds(user); using var doc = JsonDocument.Parse(await ReadStateAsync(connectionString));
    if (!doc.RootElement.TryGetProperty("vehicles", out var vehicles) || vehicles.ValueKind != JsonValueKind.Array) return false;
    foreach (var vehicle in vehicles.EnumerateArray())
        if (vehicle.TryGetProperty("id", out var id) && allowed.Contains(id.GetString() ?? string.Empty)
            && vehicle.TryGetProperty("imageStoredName", out var stored) && string.Equals(Path.GetFileName(stored.GetString()), storedName, StringComparison.OrdinalIgnoreCase)) return true;
    return false;
}

static bool IsAllowedDocumentExtension(string extension) => extension is
    ".pdf" or ".png" or ".jpg" or ".jpeg" or ".webp" or ".gif" or ".tif" or ".tiff" or
    ".txt" or ".csv" or ".md" or ".log" or ".rtf" or ".doc" or ".docx" or ".xls" or ".xlsx" or
    ".ppt" or ".pptx" or ".odt" or ".ods";
static async Task<bool> HasExpectedPdfSignatureAsync(Stream stream)
{
    if (!stream.CanSeek) return false;
    var originalPosition = stream.Position;
    try
    {
        stream.Position = 0;
        var signature = new byte[5];
        var read = await stream.ReadAsync(signature);
        return read == signature.Length && Encoding.ASCII.GetString(signature) == "%PDF-";
    }
    finally
    {
        stream.Position = originalPosition;
    }
}
static Version? ParseReleaseVersion(string? value)
{
    var match = Regex.Match(value ?? string.Empty, @"(?<!\d)(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?");
    return match.Success && Version.TryParse(match.Value, out var parsed) ? parsed : null;
}
static string GetDocumentContentType(string fileName) => Path.GetExtension(fileName).ToLowerInvariant() switch
{
    ".pdf" => "application/pdf", ".png" => "image/png", ".jpg" or ".jpeg" => "image/jpeg", ".webp" => "image/webp", ".gif" => "image/gif", ".tif" or ".tiff" => "image/tiff",
    ".txt" or ".log" => "text/plain; charset=utf-8", ".csv" => "text/csv; charset=utf-8", ".md" => "text/markdown; charset=utf-8", ".rtf" => "application/rtf",
    ".doc" => "application/msword", ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".xls" => "application/vnd.ms-excel", ".xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt" => "application/vnd.ms-powerpoint", ".pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".odt" => "application/vnd.oasis.opendocument.text", ".ods" => "application/vnd.oasis.opendocument.spreadsheet", _ => "application/octet-stream"
};
static bool CommandExists(string command) => ResolveCommandPath(command) is not null;
static string? ResolveCommandPath(string command)
{
    if (string.IsNullOrWhiteSpace(command)) return null;
    if (Path.IsPathRooted(command) && File.Exists(command)) return command;
    var executableName = OperatingSystem.IsWindows() && !command.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? command + ".exe" : command;
    var path = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
    foreach (var directory in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
    {
        try
        {
            var candidate = Path.Combine(directory.Trim(), executableName);
            if (File.Exists(candidate)) return candidate;
        }
        catch { }
    }
    if (!OperatingSystem.IsWindows()) return null;
    var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
    var programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
    var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    var commonCandidates = new List<string>();
    if (command.Equals("tesseract", StringComparison.OrdinalIgnoreCase))
    {
        commonCandidates.Add(Path.Combine(programFiles, "Tesseract-OCR", "tesseract.exe"));
        commonCandidates.Add(Path.Combine(programFilesX86, "Tesseract-OCR", "tesseract.exe"));
    }
    if (command.Equals("soffice", StringComparison.OrdinalIgnoreCase) || command.Equals("libreoffice", StringComparison.OrdinalIgnoreCase))
    {
        commonCandidates.Add(Path.Combine(programFiles, "LibreOffice", "program", "soffice.exe"));
        commonCandidates.Add(Path.Combine(programFilesX86, "LibreOffice", "program", "soffice.exe"));
    }
    commonCandidates.Add(Path.Combine(AppContext.BaseDirectory, "tools", executableName));
    commonCandidates.Add(Path.Combine(Directory.GetCurrentDirectory(), "tools", executableName));
    foreach (var candidate in commonCandidates)
    {
        if (!string.IsNullOrWhiteSpace(candidate) && File.Exists(candidate)) return candidate;
    }
    var wingetPackages = Path.Combine(localAppData, "Microsoft", "WinGet", "Packages");
    if (Directory.Exists(wingetPackages))
    {
        try
        {
            return Directory.EnumerateFiles(wingetPackages, executableName, SearchOption.AllDirectories).FirstOrDefault();
        }
        catch { }
    }
    return null;
}
static async Task<(int ExitCode,string StandardOutput,string StandardError)> RunProcessAsync(string command, IEnumerable<string> arguments, int timeoutSeconds=90)
{
    var executable = ResolveCommandPath(command) ?? command;
    var info=new ProcessStartInfo(executable){RedirectStandardOutput=true,RedirectStandardError=true,UseShellExecute=false,CreateNoWindow=true}; foreach(var argument in arguments) info.ArgumentList.Add(argument);
    using var process=new Process{StartInfo=info}; process.Start(); var stdout=process.StandardOutput.ReadToEndAsync(); var stderr=process.StandardError.ReadToEndAsync(); using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(timeoutSeconds)); await process.WaitForExitAsync(timeout.Token); return(process.ExitCode,await stdout,await stderr);
}
static async Task<string?> ConvertOfficeDocumentToPdfAsync(string sourcePath,string previewDirectory)
{
    var command=CommandExists("soffice")?"soffice":CommandExists("libreoffice")?"libreoffice":null; if(command is null)return null; var expected=Path.Combine(previewDirectory,$"{Path.GetFileNameWithoutExtension(sourcePath)}.pdf"); if(File.Exists(expected)&&File.GetLastWriteTimeUtc(expected)>=File.GetLastWriteTimeUtc(sourcePath))return expected; var result=await RunProcessAsync(command,new[]{"--headless","--convert-to","pdf","--outdir",previewDirectory,sourcePath},120); return result.ExitCode==0&&File.Exists(expected)?expected:null;
}
static async Task<DocumentTextResult> ExtractDocumentTextAsync(string path)
{
    var ext=Path.GetExtension(path).ToLowerInvariant();
    if(ext is ".txt" or ".csv" or ".md" or ".log")return new(await File.ReadAllTextAsync(path),"plain-text");
    if(ext==".rtf"){var raw=await File.ReadAllTextAsync(path);return new(WebUtility.HtmlDecode(Regex.Replace(Regex.Replace(raw,@"\\[a-z]+-?\d* ?|[{}]"," ",RegexOptions.IgnoreCase),@"\s+"," ")).Trim(),"rtf-text");}
    if(ext==".docx"){using var archive=ZipFile.OpenRead(path);var entry=archive.GetEntry("word/document.xml");if(entry is null)return new("","docx");await using var stream=entry.Open();var document=await XDocument.LoadAsync(stream,LoadOptions.None,CancellationToken.None);return new(Regex.Replace(string.Join(' ',document.DescendantNodes().OfType<XText>().Select(x=>x.Value)),@"\s+"," ").Trim(),"docx");}
    if(ext==".pdf")
    {
        var textBuilder = new StringBuilder();
        try
        {
            using var document = PdfDocument.Open(path);
            foreach (var page in document.GetPages().Take(200)) textBuilder.AppendLine(ContentOrderTextExtractor.GetText(page));
        }
        catch { }
        var managedText = Regex.Replace(textBuilder.ToString(), @"[ \t]+", " ").Trim();
        if(managedText.Length>=24)return new(managedText,"pdf-managed-text");

        var pdftotext = ResolveCommandPath("pdftotext");
        if(pdftotext is not null)
        {
            var result=await RunProcessAsync(pdftotext,new[]{"-layout","-enc","UTF-8",path,"-"},120);
            var text=result.StandardOutput.Trim();
            if(text.Length>=24)return new(text,"pdf-text");
        }

        var missing = new List<string>();
        if(ResolveCommandPath("pdftoppm") is null)missing.Add("pdftoppm");
        if(ResolveCommandPath("tesseract") is null)missing.Add("tesseract");
        if(missing.Count>0)throw new DocumentOcrRequiredException("This PDF appears to be image-based and needs OCR tools before it can be searched.",missing.ToArray());

        var temp=Path.Combine(Path.GetTempPath(),$"garagelog-ocr-{Guid.NewGuid():N}");Directory.CreateDirectory(temp);
        try
        {
            var prefix=Path.Combine(temp,"page");
            var render=await RunProcessAsync("pdftoppm",new[]{"-f","1","-l","30","-r","180","-png",path,prefix},240);
            if(render.ExitCode!=0)throw new InvalidOperationException(string.IsNullOrWhiteSpace(render.StandardError)?"Unable to render the PDF for OCR.":render.StandardError.Trim());
            var builder=new StringBuilder();
            foreach(var image in Directory.EnumerateFiles(temp,"page-*.png").OrderBy(x=>x))
            {
                var ocr=await RunProcessAsync("tesseract",new[]{image,"stdout","-l","eng","--psm","3"},180);
                if(ocr.ExitCode==0)builder.AppendLine(ocr.StandardOutput);
            }
            return new(builder.ToString().Trim(),"pdf-ocr");
        }
        finally { Directory.Delete(temp,true); }
    }
    if(ext is ".png" or ".jpg" or ".jpeg" or ".webp" or ".gif" or ".tif" or ".tiff")
    {
        if(ResolveCommandPath("tesseract") is null)throw new DocumentOcrRequiredException("Image indexing requires the local Tesseract OCR tool.",new[]{"tesseract"});
        var result=await RunProcessAsync("tesseract",new[]{path,"stdout","-l","eng","--psm","3"},180);
        if(result.ExitCode!=0)throw new InvalidOperationException(string.IsNullOrWhiteSpace(result.StandardError)?"Tesseract could not read this image.":result.StandardError.Trim());
        return new(result.StandardOutput.Trim(),"image-ocr");
    }
    return new("","unsupported");
}
static string MakeUniqueArchiveName(string requestedName,HashSet<string> used){var safe=Path.GetFileName(requestedName);if(used.Add(safe))return safe;var stem=Path.GetFileNameWithoutExtension(safe);var ext=Path.GetExtension(safe);for(var i=2;;i++){var candidate=$"{stem} ({i}){ext}";if(used.Add(candidate))return candidate;}}
static class GarageLogAuthConstants
{
    public const string CurrentUserItemKey = "GarageLog.CurrentUser";
    public const string UserSelectColumns = "Id, Username, DisplayName, PasswordHash, Role, AccessLevel, VisibilityScope, AssignedVehicleIdsJson, ProfileImageStoredName, IsActive, SecurityStamp, CreatedUtc, UpdatedUtc, LastLoginUtc";
}
static class UserRoles { public const string Administrator = "Administrator"; public const string User = "User"; }
static class AccessLevels { public const string ReadWrite = "ReadWrite"; public const string ReadOnly = "ReadOnly"; }
static class VisibilityScopes { public const string AllVehicles = "AllVehicles"; public const string SelectedVehicles = "SelectedVehicles"; }
sealed class GarageLogUser
{
    public string Id { get; set; } = string.Empty; public string Username { get; set; } = string.Empty; public string DisplayName { get; set; } = string.Empty; public string PasswordHash { get; set; } = string.Empty;
    public string Role { get; set; } = UserRoles.User; public string AccessLevel { get; set; } = AccessLevels.ReadOnly; public string VisibilityScope { get; set; } = VisibilityScopes.AllVehicles;
    public string AssignedVehicleIdsJson { get; set; } = "[]"; public string? ProfileImageStoredName { get; set; } public bool IsActive { get; set; } = true; public string SecurityStamp { get; set; } = string.Empty;
    public DateTimeOffset CreatedUtc { get; set; } public DateTimeOffset UpdatedUtc { get; set; } public DateTimeOffset? LastLoginUtc { get; set; }
}
sealed record AuthSetupRequest(string Username, string DisplayName, string Password);
sealed record AuthLoginRequest(string Username, string Password, bool RememberMe);
sealed record ProfileUpdateRequest(string Username, string DisplayName);
sealed record PasswordChangeRequest(string CurrentPassword, string NewPassword);
sealed record AdminCreateUserRequest(string Username, string DisplayName, string Password, string? Role, string? AccessLevel, string? VisibilityScope, string[]? AssignedVehicleIds);
sealed record AdminUpdateUserRequest(string Username, string DisplayName, string? Role, string? AccessLevel, string? VisibilityScope, string[]? AssignedVehicleIds, bool IsActive);
sealed record AdminResetPasswordRequest(string NewPassword);

sealed record UpdateStatusPayload(
    bool Enabled,
    string CurrentVersion,
    string? LatestVersion,
    bool UpdateAvailable,
    string? ReleaseName,
    string? ReleaseUrl,
    DateTimeOffset? PublishedAtUtc,
    DateTimeOffset CheckedAtUtc,
    string? Error);
sealed record UpdateCacheEntry(DateTimeOffset ExpiresUtc, UpdateStatusPayload Payload);
sealed record DocumentExportRequest(string[]? StoredNames,Dictionary<string,string>? FileNames);
sealed record DocumentTextResult(string Text,string Method);
sealed class DocumentOcrRequiredException : Exception
{
    public string[] MissingTools { get; }
    public DocumentOcrRequiredException(string message, string[] missingTools) : base(message) => MissingTools = missingTools;
}
sealed class DocumentToolUnavailableException : Exception
{
    public DocumentToolUnavailableException(string message) : base(message) { }
}

static class GarageLogSeed
{
    public const string Json = """
{
  "demoData": false,
  "recordContextVersion": 1,
  "stateSchemaVersion": 2,
  "setupStatus": "pending",
  "vehicle": null,
  "vehicles": [],
  "activeVehicleId": "",
  "mileage": 0,
  "mileageHistory": [],
  "metrics": {
    "averageMpg": 0
  },
  "maintenance": [],
  "expenses": [],
  "documents": [],
  "reminders": [],
  "documentFolders": [],
  "documentStorageBytes": 0,
  "expenseSettings": {
    "monthlyBudget": 500,
    "alertPercent": 85,
    "rollover": false,
    "categoryBudgets": {},
    "recurringItems": []
  },
  "savedReports": [],
  "notificationSettings": {
    "emailEnabled": false,
    "localAlertsEnabled": true,
    "readIds": [],
    "dismissedIds": []
  },
  "systemNotices": []
}
""";
}
