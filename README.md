# Hockey Soundboard

## Admin integration controls and shared API setup

Open **Admin panel** from the hamburger menu (visible only to administrators).
In **Music integrations**, check or uncheck Spotify, YouTube, and
Apple Music, then choose **Save integrations**. These settings apply to all
users and are stored in the server database, separately from account settings.
Existing integrations start enabled to preserve the prior default.

Below **Create user**, the compact **Existing users** table lists accounts with
password-reset and admin-access controls. On narrow screens, scroll the table
horizontally to reach all controls.

### Default categories

In **Default categories**, choose **Save my categories as the default** to
snapshot your categories, songs, layout, category settings, and hidden
categories. Played flags are reset; settings, tokens, roster, and score sheet
are not included. Every new account (registered or admin-created) starts with
this snapshot. The snapshot doesn't change on its own, so save again after
editing your board. To replace an existing user's categories with the snapshot,
choose **Apply defaults** in their **Existing users** row. This overwrites their
categories, and anyone already signed in must reload to see the change.

## Phone layout

On screens 720px wide or narrower, categories stack in one column in the same
order as the desktop grid. Each song list shows two songs and scrolls for the
rest. Header text, control buttons, and song cards scale with the screen width.
Category drag and resize are desktop-only; the phone layout never changes saved
desktop positions.

### Spotify on phones

iPhones (and some Android browsers) only let the Spotify player make sound after
a tap inside the player itself. When a Spotify song is started and no audio has
begun after about 2.5 seconds, the app shows the Spotify player at the bottom of
the screen with a "Tap ▶" hint. Tap play once; the player hides itself as soon
as the music starts, and clip timing and auto-stop continue as usual. Log in to
Spotify at open.spotify.com in the phone's browser to hear full tracks instead
of 30-second previews.

Disabled providers disappear from setup/help sections, import labels, song cards,
category choices, and CSV conversion instructions. Categories containing only
disabled-provider songs are hidden too. Saved songs, credentials, ordering, and
played state are not deleted; enabling the provider restores them. Local MP3s
and built-in sounds remain available. With all providers off, online import
controls and Playlist Conversion disappear, leaving a local-audio interface.
Active disabled-provider playback stops without marking its song played.

API setup is managed centrally:

- Admin stores the shared Spotify Client ID. Users still connect/disconnect their
  own Spotify accounts in Settings; changing the shared client may require
  reconnecting. Register every served callback address with the developer app.
- Admin stores the shared YouTube Data API key. It is never returned by the
  configuration API; playlist/duration requests go through the server.
  Blank replacement fields keep the stored key. Use **Clear stored API key**
  only when intentionally removing it.
- Apple Music's private signing key and Team/Key IDs stay in the server
  environment. The Admin panel provides the server setup check.

For migration, **Copy my previous API settings into this form** copies the
signed-in administrator's old per-user API values. They become shared only after
explicitly saving; other users' credentials are never promoted automatically.
Old per-user values remain saved but are no longer used for shared API requests.

Restart the server once after updating to create the configuration table and
enable the endpoints. No restart is required for later Admin changes. Other open
clients refresh configuration on focus, reconnection, or every 30 seconds while
visible. Offline clients use the last app-wide configuration cached on that
device. If configuration cannot load online, integration controls fail closed
with a visible error, while local audio remains usable.

## Playlist conversion

Choose **Playlist Conversion** in the menu, paste a Spotify, YouTube, or public Apple Music playlist
URL, enter your preferred **CSV file name**, and select **Download CSV**.
The filename box starts blank; the `.csv` extension is added automatically if
omitted and is not duplicated if included. Both boxes clear after a successful
conversion starts the download; errors leave your entries intact.
The file contains Artist, Length (min:sec),
Song Name, and Song Link, with one row per accessible playlist entry. It does not
modify soundboard categories. Spotify uses the connection in Settings; YouTube
uses the shared server Data API key. Only enabled providers are offered.
Provider access restrictions still apply.
YouTube artist values are uploader/channel names, not verified performing artists.
Unavailable song lengths are left blank. Conversion reads all playlist pages
and reports API failures instead of exporting a silently incomplete response.

## Apple Music imports (metadata and links only)

Apple Music public playlists can be imported from Music library, expanded from
spreadsheet Source links, or converted to CSV. Imported entries retain artist
names (as descriptions), lengths, and individual song links through saving,
editing, copying, category export, and sharing. Cards open Apple Music externally;
category playback and autoplay skip these entries. Full soundboard playback and
private library playlists are not supported in this stage.

The server administrator needs Apple Developer Program membership and a MusicKit
private key. Install `requirements.txt`, then set these environment variables in
the server process and restart it:

- `SOUNDBOARD_APPLE_TEAM_ID`: Apple's 10-character Team ID.
- `SOUNDBOARD_APPLE_KEY_ID`: the MusicKit key's 10-character Key ID.
- `SOUNDBOARD_APPLE_PRIVATE_KEY_PATH`: an absolute path to the `.p8` private key,
  **outside the publicly served app folder**.

Never commit the key or place it in browser settings, app assets, or a deployment
archive. The authenticated `/api/apple-music/token` endpoint signs one-hour ES256
developer tokens; the private key stays on the server. Tokens are used transiently
by the browser, are not saved to account settings, and are not service-worker
cached. Admin's **Check server setup** verifies signing configuration; a real
playlist request verifies Apple's acceptance and playlist access.

Use a full `https://music.apple.com/{region}/playlist/.../pl...` link. The URL's
region controls catalog availability. All track pages are fetched before
import/export; non-song entries are skipped, missing durations are blank in CSV,
and any failed page aborts the operation. No Apple Music subscriber login is
required for public catalog metadata. See `how-to.html#apple-music` for setup.

In a song's settings, choose another category under **Copy to category**, then
select **Copy song**. This copies the saved source and timing without moving the
original; save pending edits first. The copy starts unplayed and can be edited
independently. Local MP3 copies share the stored audio file, which is retained
while another song still references it.

YouTube songs use a hidden embedded player. Playback depends on the video's
availability and embedding permissions; the app reports player errors and
autoplay blocks in its status bar. If autoplay is blocked, allow autoplay for
the site in your browser and retry, or use a local MP3. Unavailable or embedding-restricted videos need a different
video source or a local MP3. Use localhost or the hosted site rather than opening
the HTML file directly.

Spotify clips use the selected Start/Stop times rather than the full song length.
Playback timing follows the player's position and pauses while buffering.
The active song shows its current MM:SS position beside its source badge,
including the clip's start offset. The timestamp remains visible while paused.

**Stop** beside Pause ends music playback and cancels autoplay/crossfade timers.
Resume cannot restart a stopped song; select a song or category to play again.
Stopping before 7 seconds leaves a song unplayed; at 7 seconds or more it is
marked played, except repeatable songs. Time spent paused does not count.
The separate horn control is unaffected.
Greyed-out played songs cannot play again until reset, but their settings menu
and drag-and-drop remain available. Moving or editing them preserves played state.

The hamburger menu contains **Team Roster**, **Game Score Sheet**, **Game Rules**, and
**Settings**. Choose **Settings** to open a pop-out settings dialog. Close it with
**Close**, Escape, or a click outside the dialog.

## Game rules

**Game Rules** opens a source-linked quick reference for Sno-King (SKAHA) 12U C
recreational/MHL play. It covers game timing, MHL minor penalties, ice curfew,
and USA Hockey 12U contact, offside, icing, and neck-protection rules. Sources
were checked October 5, 2026; the summary is bundled with the app, not live-updated.
Select, tournament, and playoff rules may differ. Confirm event-specific rules
with the officials and team manager, and consult the linked official documents.

## Game score sheet

Open **Game Score Sheet** after **Team Roster** in the hamburger menu. The blank
sheet includes game details, both 17-player rosters, scoring, goaltender records,
coaches, officials, team contacts, and penalties. Entries are saved in this
browser's local storage; they are not synced between devices.

Use **Download PDF** to save a completed, single-page Letter-size PDF, or download
the blank sheet as a template. PDF creation runs locally without uploading player
information or requiring an external library. The PDF is a high-resolution image
of the completed sheet, not an editable PDF form. Typed sign-offs are not digital
signatures. On narrow screens, scroll horizontally to access the entire sheet.
**Reset Score Sheet** asks for confirmation before clearing all entries and the
saved draft in this browser. Canceling leaves the sheet unchanged.

## Password recovery email

The app can send verification and password-reset links through Microsoft Graph or SMTP. Graph is the configured provider in `deploy-azure.ps1`.

### Microsoft Graph with a personal Outlook.com mailbox

This uses delegated `Mail.Send` permission and a one-time device-code sign-in. No Microsoft account password or client secret is stored by the app.

1. Register an application in Microsoft Entra ID with support for **Personal Microsoft accounts**.
2. Add the delegated Microsoft Graph permission `Mail.Send`. Enable public client flows for device-code authorization.
3. Configure these App Service application settings:
   - `SOUNDBOARD_EMAIL_PROVIDER=graph`
   - `SOUNDBOARD_GRAPH_CLIENT_ID=<application-client-id>`
   - `SOUNDBOARD_PUBLIC_URL=https://<app-name>.azurewebsites.net`
4. In the App Service SSH console, run `python server.py --authorize-email` and complete the sign-in at the verification URL using the Outlook.com mailbox that should send the email.

The MSAL token cache is written to `/home/data/graph-token-cache.json` on Azure App Service, which persists across app restarts and deployments. The cache is excluded from deployment archives and static file access. Keep access to the App Service restricted; rerun the authorization command if the user revokes consent or the refresh token expires.

The deployment script defaults to the Basic B1 App Service tier for reliable hosting; this is a recurring paid resource (roughly $13/month in West US 2, before other charges). To use the Free F1 tier instead, provide `-Sku F1`; F1 has strict usage limits and does not support Always On.

For local development, set `SOUNDBOARD_GRAPH_CLIENT_ID`, then run `python server.py --authorize-email` once before starting the server. The cache is written to `~/.hockey-soundboard/graph-token-cache.json`, outside the public app directory.

### SMTP alternative

Set `SOUNDBOARD_EMAIL_PROVIDER=smtp` and configure:

- `SOUNDBOARD_SMTP_HOST`: SMTP server hostname.
- `SOUNDBOARD_SMTP_FROM`: sender address accepted by the SMTP provider.
- `SOUNDBOARD_SMTP_PORT`: SMTP port (defaults to `587`).
- `SOUNDBOARD_SMTP_USER` and `SOUNDBOARD_SMTP_PASSWORD`: optional SMTP credentials.
- `SOUNDBOARD_SMTP_SSL`: set to `true` for implicit TLS (typically port `465`); otherwise the server negotiates STARTTLS.

For Azure App Service, set SMTP credentials under **Configuration > Application settings** or use Key Vault references. Do not put credentials in source control.

Verification and reset links are single-use and expire after 30 minutes. Reset requests return the same confirmation whether or not the email belongs to a verified account. Existing users can sign in, save a recovery email in Settings, and verify it there.
