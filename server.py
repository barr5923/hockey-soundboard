"""Static file server plus a small account/sync API for the Hockey Soundboard.

Run:  python server.py [port]        (default port 8000)
Env:  SOUNDBOARD_HOST   bind address (default 0.0.0.0 so other devices can log in)
      SOUNDBOARD_INVITE if set, new accounts must supply this invite code
      SOUNDBOARD_PUBLIC_URL, SOUNDBOARD_EMAIL_PROVIDER
      Microsoft Graph settings: SOUNDBOARD_GRAPH_CLIENT_ID,
      SMTP settings: SOUNDBOARD_SMTP_HOST, SOUNDBOARD_SMTP_FROM,
      SOUNDBOARD_SMTP_PORT, SOUNDBOARD_SMTP_USER, SOUNDBOARD_SMTP_PASSWORD,
      SOUNDBOARD_SMTP_SSL

Run `python server.py --authorize-email` once to authorize a Microsoft Graph mailbox.
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import smtplib
import ssl
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request
from email.message import EmailMessage
from http import cookies
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlparse, urlsplit

import msal
from apple_music import AppleMusicConfigurationError, create_developer_token
from integrations import public_config, read_config, track_enabled, validate_update

ROOT = os.path.dirname(os.path.abspath(__file__))
# On Azure App Service (Linux) only /home persists across restarts and deployments.
DEFAULT_DATA_DIR = '/home/data' if os.environ.get('WEBSITE_SITE_NAME') else ROOT
DB_PATH = os.environ.get('SOUNDBOARD_DB') or os.path.join(DEFAULT_DATA_DIR, 'soundboard-users.db')
SESSION_COOKIE = 'hs_session'
SESSION_SECONDS = 30 * 24 * 3600
MAX_BODY = 12 * 1024 * 1024
DEFAULT_ADMIN_USERNAME = 'admin'
DEFAULT_ADMIN_PASSWORD = os.environ.get('SOUNDBOARD_ADMIN_PASSWORD') or 'admin'
USERNAME_RE = re.compile(r'^[A-Za-z0-9_.-]{3,32}$')
EMAIL_RE = re.compile(r'^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,63}$')
INVITE_CODE = os.environ.get('SOUNDBOARD_INVITE', '')
RESET_SECONDS = 30 * 60
PRIVATE_FILES = {
    'server.py', 'apple_music.py', 'integrations.py', 'soundboard-users.db', 'soundboard-users.db-journal',
    'graph-token-cache.json', 'graph-token-cache.json.tmp',
    'requirements.txt', 'deploy-azure.ps1',
}

db_lock = threading.Lock()
failed_logins = {}
reset_attempts = {}
reset_password_attempts = {}
graph_token_cache_lock = threading.Lock()
GRAPH_SCOPES = ['https://graph.microsoft.com/Mail.Send']


MAX_SHARED_TRACKS = 500
SHARED_TEXT_FIELDS = {'name': 120, 'description': 300, 'mood': 40}
SHARED_URL_FIELDS = ('spotifyUrl', 'youtubeUrl', 'youtubeEmbedUrl', 'appleMusicUrl')


def sanitize_shared_track(track):
    if not isinstance(track, dict):
        return None
    clean = {}
    for field, limit in SHARED_TEXT_FIELDS.items():
        value = track.get(field)
        clean[field] = value.strip()[:limit] if isinstance(value, str) else ''
    for field in SHARED_URL_FIELDS:
        value = track.get(field)
        clean[field] = value[:500] if isinstance(value, str) and value.lower().startswith(('https://', 'http://')) else ''
    audio = track.get('audioDataUrl')
    clean['audioDataUrl'] = audio if isinstance(audio, str) and audio.lower().startswith('data:audio/') else ''
    for field in ('startTime', 'stopTime', 'durationSeconds'):
        try:
            clean[field] = max(0, int(track.get(field) or 0))
        except (TypeError, ValueError):
            clean[field] = 0
    if not clean['name'] or not (clean['spotifyUrl'] or clean['youtubeUrl'] or clean['appleMusicUrl'] or clean['audioDataUrl']):
        return None
    return clean


DEFAULT_BOARD_CONFIG_KEY = 'default_board'
DEFAULT_BOARD_PLAYLISTS_KEY = 'hockey-soundboard-playlists-v1'
DEFAULT_BOARD_KEYS = (
    DEFAULT_BOARD_PLAYLISTS_KEY,
    'hockey-soundboard-category-grid-v2',
    'hockey-soundboard-category-settings-v1',
    'hockey-soundboard-hidden-categories-v1',
)


def build_default_board(conn, user_id):
    rows = conn.execute(
        f'SELECT key, value FROM user_data WHERE user_id = ? AND key IN ({",".join("?" * len(DEFAULT_BOARD_KEYS))})',
        (user_id, *DEFAULT_BOARD_KEYS)
    ).fetchall()
    data = {row['key']: row['value'] for row in rows}
    try:
        playlists = json.loads(data.get(DEFAULT_BOARD_PLAYLISTS_KEY) or 'null')
    except ValueError:
        playlists = None
    if not isinstance(playlists, dict) or not playlists:
        raise ValueError('This account has no saved categories to use as the default.')
    for tracks in playlists.values():
        for track in tracks if isinstance(tracks, list) else []:
            if isinstance(track, dict):
                track['played'] = False
    data[DEFAULT_BOARD_PLAYLISTS_KEY] = json.dumps(playlists)
    return data


def read_default_board(conn):
    row = conn.execute('SELECT value FROM app_config WHERE key = ?', (DEFAULT_BOARD_CONFIG_KEY,)).fetchone()
    if not row:
        return None
    try:
        board = json.loads(row['value'])
    except ValueError:
        return None
    return board if isinstance(board, dict) and isinstance(board.get('data'), dict) else None


def default_board_summary(board):
    if not board:
        return {'exists': False}
    try:
        playlists = json.loads(board['data'].get(DEFAULT_BOARD_PLAYLISTS_KEY) or '{}')
    except ValueError:
        playlists = {}
    categories = [key for key in playlists if key != 'built-in-sounds']
    return {
        'exists': True,
        'savedBy': board.get('savedBy', ''),
        'savedAt': board.get('savedAt', 0),
        'categoryCount': len(categories),
        'songCount': sum(len(playlists[key]) for key in categories if isinstance(playlists[key], list)),
    }


def apply_default_board(conn, user_id):
    board = read_default_board(conn)
    if not board:
        return False
    conn.execute(
        f'DELETE FROM user_data WHERE user_id = ? AND key IN ({",".join("?" * len(DEFAULT_BOARD_KEYS))})',
        (user_id, *DEFAULT_BOARD_KEYS)
    )
    for key, value in board['data'].items():
        if key in DEFAULT_BOARD_KEYS and isinstance(value, str):
            conn.execute('INSERT INTO user_data (user_id, key, value) VALUES (?, ?, ?)', (user_id, key, value))
    return True


def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with db_lock, get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS app_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                salt BLOB NOT NULL,
                hash BLOB NOT NULL,
                email TEXT COLLATE NOCASE,
                email_verified INTEGER NOT NULL DEFAULT 0,
                created REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_data (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (user_id, key)
            );
            CREATE TABLE IF NOT EXISTS shared_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                key TEXT NOT NULL,
                name TEXT NOT NULL,
                tracks TEXT NOT NULL,
                updated REAL NOT NULL,
                UNIQUE (owner_id, key)
            );
            CREATE TABLE IF NOT EXISTS password_resets (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS email_verifications (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                email TEXT NOT NULL,
                expires REAL NOT NULL
            );
        """)
        columns = {row['name'] for row in conn.execute('PRAGMA table_info(users)')}
        if 'email' not in columns:
            conn.execute('ALTER TABLE users ADD COLUMN email TEXT COLLATE NOCASE')
        if 'email_verified' not in columns:
            conn.execute('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0')
        if 'is_admin' not in columns:
            conn.execute('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0')
        conn.execute('CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email)')
        if not conn.execute('SELECT 1 FROM users WHERE username = ?', (DEFAULT_ADMIN_USERNAME,)).fetchone():
            salt = secrets.token_bytes(16)
            conn.execute(
                'INSERT INTO users (username, salt, hash, email, is_admin, created) VALUES (?, ?, ?, NULL, 1, ?)',
                (DEFAULT_ADMIN_USERNAME, salt, hash_password(DEFAULT_ADMIN_PASSWORD, salt), time.time())
            )


def hash_password(password, salt):
    return hashlib.scrypt(password.encode('utf-8'), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)


def token_digest(token):
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def graph_token_cache_path():
    data_dir = DEFAULT_DATA_DIR if os.environ.get('WEBSITE_SITE_NAME') else os.path.join(
        os.path.expanduser('~'), '.hockey-soundboard'
    )
    return os.path.join(data_dir, 'graph-token-cache.json')


def graph_msal_app(cache):
    client_id = os.environ.get('SOUNDBOARD_GRAPH_CLIENT_ID', '').strip()
    if not client_id:
        raise RuntimeError('Configure SOUNDBOARD_GRAPH_CLIENT_ID before authorizing email.')
    return msal.PublicClientApplication(
        client_id,
        authority='https://login.microsoftonline.com/consumers',
        token_cache=cache,
    )


def save_graph_token_cache(cache):
    cache_path = graph_token_cache_path()
    os.makedirs(os.path.dirname(os.path.abspath(cache_path)), exist_ok=True)
    temporary_path = f'{cache_path}.tmp'
    with open(temporary_path, 'w', encoding='utf-8') as cache_file:
        cache_file.write(cache.serialize())
    if os.name != 'nt':
        os.chmod(temporary_path, 0o600)
    os.replace(temporary_path, cache_path)


def authorize_graph_email():
    cache = msal.SerializableTokenCache()
    app = graph_msal_app(cache)
    flow = app.initiate_device_flow(scopes=GRAPH_SCOPES)
    if 'user_code' not in flow or 'message' not in flow:
        raise RuntimeError(f'Could not start Microsoft sign-in: {flow.get("error_description", "unknown error")}')

    print(flow['message'], flush=True)
    result = app.acquire_token_by_device_flow(flow)
    if 'access_token' not in result:
        raise RuntimeError(f'Microsoft sign-in failed: {result.get("error_description", "unknown error")}')

    with graph_token_cache_lock:
        save_graph_token_cache(cache)
    print(f'Microsoft Graph email authorization saved to {graph_token_cache_path()}.', flush=True)


def get_graph_access_token():
    cache_path = graph_token_cache_path()
    if not os.path.isfile(cache_path):
        raise RuntimeError('Microsoft Graph email is not authorized; run "python server.py --authorize-email".')

    with graph_token_cache_lock:
        cache = msal.SerializableTokenCache()
        with open(cache_path, encoding='utf-8') as cache_file:
            cache.deserialize(cache_file.read())
        app = graph_msal_app(cache)
        accounts = app.get_accounts()
        if not accounts:
            raise RuntimeError('Microsoft Graph email is not authorized; run "python server.py --authorize-email".')

        result = app.acquire_token_silent(GRAPH_SCOPES, account=accounts[0])
        if not result or 'access_token' not in result:
            details = result.get('error_description', 'authorization has expired or been revoked') if result else \
                'authorization has expired or been revoked'
            raise RuntimeError(f'Could not refresh the Microsoft Graph access token: {details}')
        if cache.has_state_changed:
            save_graph_token_cache(cache)
        return result['access_token']


def send_graph_email(email, subject, content):
    access_token = get_graph_access_token()
    payload = json.dumps({
        'message': {
            'subject': subject,
            'body': {'contentType': 'Text', 'content': content},
            'toRecipients': [{'emailAddress': {'address': email}}],
        },
    }).encode('utf-8')
    request = urllib.request.Request(
        'https://graph.microsoft.com/v1.0/me/sendMail',
        data=payload,
        headers={
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=15):
            pass
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'Microsoft Graph email send failed with HTTP {error.code}.') from error


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # ---------- helpers ----------
    def send_json(self, status, payload, extra_headers=None):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        for name, value in (extra_headers or []):
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        if 'application/json' not in self.headers.get('Content-Type', ''):
            return None
        origin = self.headers.get('Origin')
        if origin and urlparse(origin).netloc != self.headers.get('Host'):
            return None
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            return None
        if length <= 0 or length > MAX_BODY:
            return None
        try:
            data = json.loads(self.rfile.read(length).decode('utf-8'))
        except (ValueError, UnicodeDecodeError):
            return None
        return data if isinstance(data, dict) else None

    def current_user(self):
        header = self.headers.get('Cookie')
        if not header:
            return None
        jar = cookies.SimpleCookie()
        try:
            jar.load(header)
        except cookies.CookieError:
            return None
        morsel = jar.get(SESSION_COOKIE)
        if not morsel:
            return None
        with db_lock, get_db() as conn:
            return conn.execute(
                'SELECT u.id, u.username, u.email, u.email_verified, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id '
                'WHERE s.token_hash = ? AND s.expires > ?',
                (token_digest(morsel.value), time.time())
            ).fetchone()

    def is_https(self):
        return self.headers.get('X-Forwarded-Proto', '').split(',')[0].strip() == 'https'

    def client_ip(self):
        forwarded = self.headers.get('X-Forwarded-For', '')
        return forwarded.split(',')[0].strip().split(':')[0] if forwarded else self.client_address[0]

    def session_cookie(self, token, max_age):
        secure = '; Secure' if self.is_https() else ''
        return ('Set-Cookie', f'{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}')

    def start_session(self, conn, user_id):
        token = secrets.token_urlsafe(32)
        conn.execute('DELETE FROM sessions WHERE expires < ?', (time.time(),))
        conn.execute('INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)',
                     (token_digest(token), user_id, time.time() + SESSION_SECONDS))
        return self.session_cookie(token, SESSION_SECONDS)

    # ---------- routing ----------
    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith('/api/'):
            self.handle_api('GET', path)
        elif os.path.basename(path.rstrip('/')).lower() in PRIVATE_FILES:
            self.send_error(404)
        else:
            super().do_GET()

    def do_HEAD(self):
        if os.path.basename(urlparse(self.path).path.rstrip('/')).lower() in PRIVATE_FILES:
            self.send_error(404)
        else:
            super().do_HEAD()

    def do_POST(self):
        self.handle_api('POST', urlparse(self.path).path)

    def do_PUT(self):
        self.handle_api('PUT', urlparse(self.path).path)

    def handle_api(self, method, path):
        routes = {
            ('GET', '/api/me'): self.api_me,
            ('GET', '/api/integrations'): self.api_integrations,
            ('GET', '/api/admin/integrations'): self.api_admin_integrations,
            ('PUT', '/api/admin/integrations'): self.api_save_integrations,
            ('GET', '/api/youtube'): self.api_youtube,
            ('GET', '/api/apple-music/token'): self.api_apple_music_token,
            ('POST', '/api/register'): self.api_register,
            ('POST', '/api/login'): self.api_login,
            ('POST', '/api/recovery-email'): self.api_recovery_email,
            ('POST', '/api/send-recovery-verification'): self.api_send_recovery_verification,
            ('POST', '/api/verify-email'): self.api_verify_email,
            ('POST', '/api/forgot-password'): self.api_forgot_password,
            ('POST', '/api/reset-password'): self.api_reset_password,
            ('POST', '/api/logout'): self.api_logout,
            ('POST', '/api/change-password'): self.api_change_password,
            ('GET', '/api/admin/users'): self.api_admin_users,
            ('POST', '/api/admin/set-password'): self.api_admin_set_password,
            ('POST', '/api/admin/set-admin'): self.api_admin_set_admin,
            ('POST', '/api/admin/create-user'): self.api_admin_create_user,
            ('GET', '/api/admin/default-board'): self.api_admin_default_board,
            ('POST', '/api/admin/default-board/save'): self.api_admin_save_default_board,
            ('POST', '/api/admin/default-board/apply'): self.api_admin_apply_default_board,
            ('GET', '/api/shared-categories'): self.api_shared_list,
            ('GET', '/api/shared-category'): self.api_shared_get,
            ('PUT', '/api/shared-categories'): self.api_shared_publish,
            ('POST', '/api/shared-categories/unshare'): self.api_shared_unshare,
            ('GET', '/api/google-sheet'): self.api_google_sheet,
            ('GET', '/api/data'): self.api_get_data,
            ('PUT', '/api/data'): self.api_put_data,
        }
        route = routes.get((method, path))
        if route is None:
            self.send_json(404, {'error': 'Not found'})
            return
        route()

    # ---------- endpoints ----------
    def api_integrations(self):
        with db_lock, get_db() as conn:
            config = read_config(conn)
        self.send_json(200, public_config(config))

    def api_admin_integrations(self):
        if not self.require_admin():
            return
        self.api_integrations()

    def api_save_integrations(self):
        if not self.require_admin():
            return
        body = self.read_json()
        with db_lock, get_db() as conn:
            try:
                config = validate_update(body, read_config(conn))
            except ValueError as error:
                self.send_json(400, {'error': str(error)})
                return
            conn.execute(
                "INSERT INTO app_config (key, value) VALUES ('integrations', ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (json.dumps(config),)
            )
        self.send_json(200, public_config(config))

    def api_youtube(self):
        if not self.current_user():
            self.send_json(401, {'error': 'Log in to use playlist imports.'})
            return
        with db_lock, get_db() as conn:
            config = read_config(conn)
        if not config['enabled']['youtube']:
            self.send_json(403, {'error': 'This integration is disabled by the administrator.'})
            return
        if not config['youtubeApiKey']:
            self.send_json(503, {'error': 'The administrator must configure the shared API key.'})
            return
        query = parse_qs(urlparse(self.path).query)
        resource = query.get('resource', [''])[0]
        params = {'key': config['youtubeApiKey']}
        if resource == 'playlistItems':
            playlist_id = query.get('playlistId', [''])[0]
            page_token = query.get('pageToken', [''])[0]
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', playlist_id) or len(page_token) > 512:
                self.send_json(400, {'error': 'Invalid playlist request.'})
                return
            params.update(part='snippet,contentDetails', maxResults='50', playlistId=playlist_id)
            if page_token:
                params['pageToken'] = page_token
        elif resource == 'videos':
            ids = query.get('id', [''])[0].split(',')
            if not 1 <= len(ids) <= 50 or any(not re.fullmatch(r'[A-Za-z0-9_-]{11}', item) for item in ids):
                self.send_json(400, {'error': 'Invalid song duration request.'})
                return
            params.update(part='contentDetails', id=','.join(ids))
        else:
            self.send_json(400, {'error': 'Unsupported playlist request.'})
            return
        request = urllib.request.Request(
            f'https://www.googleapis.com/youtube/v3/{resource}?{urlencode(params)}'
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as error:
            self.log_error('Playlist provider returned HTTP %s', error.code)
            self.send_json(502, {'error': 'Playlist provider denied the request. Ask the administrator to check API permissions and quota.'})
            return
        except (urllib.error.URLError, TimeoutError, ValueError) as error:
            self.log_error('Playlist provider request failed (%s)', type(error).__name__)
            self.send_json(502, {'error': 'Could not reach the playlist provider. Please try again.'})
            return
        self.send_json(200, payload)

    def api_apple_music_token(self):
        if not self.current_user():
            self.send_json(401, {'error': 'Log in to use Apple Music imports.'})
            return
        with db_lock, get_db() as conn:
            config = read_config(conn)
        if not config['enabled']['appleMusic']:
            self.send_json(403, {'error': 'This integration is disabled by the administrator.'})
            return
        try:
            token = create_developer_token(ROOT)
        except AppleMusicConfigurationError as error:
            self.log_error('Apple Music configuration failed: %s', error)
            self.send_json(503, {'error': str(error)})
            return
        self.send_json(200, {'token': token})

    def api_me(self):
        user = self.current_user()
        if not user:
            self.send_json(401, {'error': 'Not logged in', 'inviteRequired': bool(INVITE_CODE)})
            return
        self.send_json(200, {
            'id': user['id'],
            'username': user['username'],
            'email': user['email'] or '',
            'emailVerified': bool(user['email_verified']),
            'isAdmin': bool(user['is_admin'])
        })

    def require_admin(self):
        user = self.current_user()
        if not user:
            self.send_json(401, {'error': 'Not logged in'})
            return None
        if not user['is_admin']:
            self.send_json(403, {'error': 'Admin access required.'})
            return None
        return user

    def api_admin_users(self):
        if not self.require_admin():
            return
        with db_lock, get_db() as conn:
            rows = conn.execute(
                'SELECT id, username, email, is_admin, created FROM users ORDER BY username COLLATE NOCASE'
            ).fetchall()
        self.send_json(200, {'users': [{
            'id': row['id'],
            'username': row['username'],
            'email': row['email'] or '',
            'isAdmin': bool(row['is_admin']),
            'created': row['created']
        } for row in rows]})

    def api_change_password(self):
        user = self.current_user()
        if not user:
            self.send_json(401, {'error': 'Not logged in'})
            return
        body = self.read_json()
        if body is None:
            self.send_json(400, {'error': 'Invalid request'})
            return
        password = str(body.get('password', ''))
        confirmation = str(body.get('passwordConfirmation', ''))
        if len(password) < 8 or len(password) > 200:
            self.send_json(400, {'error': 'Password must be at least 8 characters.'})
            return
        if password != confirmation:
            self.send_json(400, {'error': 'Passwords do not match.'})
            return
        salt = secrets.token_bytes(16)
        with db_lock, get_db() as conn:
            conn.execute('UPDATE users SET salt = ?, hash = ? WHERE id = ?',
                         (salt, hash_password(password, salt), user['id']))
            conn.execute('DELETE FROM sessions WHERE user_id = ?', (user['id'],))
            conn.execute('DELETE FROM password_resets WHERE user_id = ?', (user['id'],))
            cookie = self.start_session(conn, user['id'])
        self.send_json(200, {'message': 'Password changed. Other devices have been signed out.'}, [cookie])
    def api_admin_create_user(self):
        if not self.require_admin():
            return
        body = self.read_json()
        if body is None:
            self.send_json(400, {'error': 'Invalid request'})
            return
        username = str(body.get('username', '')).strip()
        password = str(body.get('password', ''))
        email = str(body.get('email', '')).strip().lower()
        make_admin = body.get('isAdmin') is True
        if not USERNAME_RE.match(username):
            self.send_json(400, {'error': 'Username must be 3-32 letters, numbers, dots, dashes or underscores.'})
            return
        if email and (len(email) > 254 or not EMAIL_RE.match(email)):
            self.send_json(400, {'error': 'Enter a valid email address or leave it blank.'})
            return
        if len(password) < 8 or len(password) > 200:
            self.send_json(400, {'error': 'Password must be at least 8 characters.'})
            return
        salt = secrets.token_bytes(16)
        pw_hash = hash_password(password, salt)
        with db_lock, get_db() as conn:
            try:
                cursor = conn.execute(
                    'INSERT INTO users (username, salt, hash, email, is_admin, created) VALUES (?, ?, ?, ?, ?, ?)',
                    (username, salt, pw_hash, email or None, 1 if make_admin else 0, time.time())
                )
                apply_default_board(conn, cursor.lastrowid)
                conn.commit()
                status, payload = 200, {'id': cursor.lastrowid, 'username': username, 'email': email,
                                        'isAdmin': make_admin}
            except sqlite3.IntegrityError:
                duplicate = conn.execute('SELECT 1 FROM users WHERE username = ?', (username,)).fetchone()
                status, payload = 409, {'error': 'That username is taken.' if duplicate else 'That email is already in use.'}
        self.send_json(status, payload)

    def admin_target_id(self, body):
        user_id = body.get('userId') if body else None
        return user_id if isinstance(user_id, int) and not isinstance(user_id, bool) else None

    def api_admin_default_board(self):
        if not self.require_admin():
            return
        with db_lock, get_db() as conn:
            summary = default_board_summary(read_default_board(conn))
        self.send_json(200, summary)

    def api_admin_save_default_board(self):
        user = self.require_admin()
        if not user:
            return
        with db_lock, get_db() as conn:
            try:
                data = build_default_board(conn, user['id'])
            except ValueError as error:
                self.send_json(400, {'error': str(error)})
                return
            board = {'data': data, 'savedBy': user['username'], 'savedAt': time.time()}
            conn.execute(
                'INSERT INTO app_config (key, value) VALUES (?, ?) '
                'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
                (DEFAULT_BOARD_CONFIG_KEY, json.dumps(board))
            )
        self.send_json(200, default_board_summary(board))

    def api_admin_apply_default_board(self):
        if not self.require_admin():
            return
        user_id = self.admin_target_id(self.read_json())
        if user_id is None:
            self.send_json(400, {'error': 'Invalid request'})
            return
        with db_lock, get_db() as conn:
            if not conn.execute('SELECT 1 FROM users WHERE id = ?', (user_id,)).fetchone():
                status, payload = 404, {'error': 'User not found.'}
            elif not apply_default_board(conn, user_id):
                status, payload = 400, {'error': 'Save a default board first.'}
            else:
                status, payload = 200, {'message': 'Default categories applied.'}
        self.send_json(status, payload)

    def api_admin_set_password(self):
        if not self.require_admin():
            return
        body = self.read_json()
        user_id = self.admin_target_id(body)
        password = str(body.get('password', '')) if body else ''
        if user_id is None:
            self.send_json(400, {'error': 'Invalid request'})
            return
        if len(password) < 8 or len(password) > 200:
            self.send_json(400, {'error': 'Password must be at least 8 characters.'})
            return
        salt = secrets.token_bytes(16)
        pw_hash = hash_password(password, salt)
        with db_lock, get_db() as conn:
            updated = conn.execute('UPDATE users SET salt = ?, hash = ? WHERE id = ?', (salt, pw_hash, user_id)).rowcount
            if updated:
                conn.execute('DELETE FROM sessions WHERE user_id = ?', (user_id,))
                conn.execute('DELETE FROM password_resets WHERE user_id = ?', (user_id,))
            conn.commit()
        if not updated:
            self.send_json(404, {'error': 'User not found.'})
            return
        self.send_json(200, {'message': 'Password updated. The user has been signed out everywhere.'})

    def api_admin_set_admin(self):
        if not self.require_admin():
            return
        body = self.read_json()
        user_id = self.admin_target_id(body)
        make_admin = body.get('isAdmin') if body else None
        if user_id is None or not isinstance(make_admin, bool):
            self.send_json(400, {'error': 'Invalid request'})
            return
        with db_lock, get_db() as conn:
            target = conn.execute('SELECT is_admin FROM users WHERE id = ?', (user_id,)).fetchone()
            if not target:
                status, payload = 404, {'error': 'User not found.'}
            elif not make_admin and target['is_admin'] and \
                    conn.execute('SELECT COUNT(*) FROM users WHERE is_admin = 1').fetchone()[0] <= 1:
                status, payload = 400, {'error': 'There must be at least one admin.'}
            else:
                conn.execute('UPDATE users SET is_admin = ? WHERE id = ?', (1 if make_admin else 0, user_id))
                conn.commit()
                status, payload = 200, {'id': user_id, 'isAdmin': make_admin}
        self.send_json(status, payload)

    def api_register(self):
        body = self.read_json()
        if body is None:
            self.send_json(400, {'error': 'Invalid request'})
            return
        username = str(body.get('username', '')).strip()
        password = str(body.get('password', ''))
        password_confirmation = str(body.get('passwordConfirmation', ''))
        email = str(body.get('email', '')).strip().lower()
        if not USERNAME_RE.match(username):
            self.send_json(400, {'error': 'Username must be 3-32 letters, numbers, dots, dashes or underscores.'})
            return
        if len(email) > 254 or not EMAIL_RE.match(email):
            self.send_json(400, {'error': 'Enter a valid email address for password recovery.'})
            return
        if len(password) < 8 or len(password) > 200:
            self.send_json(400, {'error': 'Password must be at least 8 characters.'})
            return
        if password != password_confirmation:
            self.send_json(400, {'error': 'Passwords do not match.'})
            return
        if INVITE_CODE and not hmac.compare_digest(str(body.get('invite', '')), INVITE_CODE):
            self.send_json(403, {'error': 'Invalid invite code.'})
            return
        salt = secrets.token_bytes(16)
        pw_hash = hash_password(password, salt)
        with db_lock, get_db() as conn:
            first = not conn.execute('SELECT 1 FROM users WHERE username != ?', (DEFAULT_ADMIN_USERNAME,)).fetchone()
            try:
                cursor = conn.execute('INSERT INTO users (username, salt, hash, email, created) VALUES (?, ?, ?, ?, ?)',
                                      (username, salt, pw_hash, email, time.time()))
            except sqlite3.IntegrityError:
                duplicate = conn.execute('SELECT 1 FROM users WHERE username = ?', (username,)).fetchone()
                message = 'That username is taken.' if duplicate else 'That email is already in use.'
                self.send_json(409, {'error': message})
                return
            user_id = cursor.lastrowid
            apply_default_board(conn, user_id)
            cookie = self.start_session(conn, user_id)
        verification_sent = self.issue_email_verification(user_id, email)
        self.send_json(200, {
            'id': user_id,
            'username': username,
            'email': email,
            'emailVerified': False,
            'isAdmin': False,
            'verificationSent': verification_sent,
            'first': first
        }, [cookie])

    def api_login(self):
        body = self.read_json()
        if body is None:
            self.send_json(400, {'error': 'Invalid request'})
            return
        username = str(body.get('username', '')).strip()
        password = str(body.get('password', ''))
        key = (self.client_ip(), username.lower())
        attempts = [t for t in failed_logins.get(key, []) if t > time.time() - 300]
        if len(attempts) >= 8:
            self.send_json(429, {'error': 'Too many attempts. Try again in a few minutes.'})
            return
        with db_lock, get_db() as conn:
            row = conn.execute(
                'SELECT id, username, salt, hash, email, email_verified, is_admin FROM users WHERE username = ?',
                (username,)
            ).fetchone()
            salt = row['salt'] if row else b'\0' * 16
            candidate = hash_password(password[:200], salt)
            if not row or not hmac.compare_digest(candidate, row['hash']):
                attempts.append(time.time())
                failed_logins[key] = attempts
                self.send_json(401, {'error': 'Incorrect username or password.'})
                return
            failed_logins.pop(key, None)
            cookie = self.start_session(conn, row['id'])
        self.send_json(200, {
            'id': row['id'],
            'username': row['username'],
            'email': row['email'] or '',
            'emailVerified': bool(row['email_verified']),
            'isAdmin': bool(row['is_admin'])
        }, [cookie])

    def api_recovery_email(self):
        user = self.current_user()
        if not user:
            self.send_json(401, {'error': 'Not logged in'})
            return
        body = self.read_json()
        email = str(body.get('email', '')).strip().lower() if body else ''
        if body is None or len(email) > 254 or not EMAIL_RE.match(email):
            self.send_json(400, {'error': 'Enter a valid email address.'})
            return
        if email == user['email'] and user['email_verified']:
            self.send_json(200, {'email': email, 'emailVerified': True, 'verificationSent': False})
            return
        with db_lock, get_db() as conn:
            try:
                conn.execute('UPDATE users SET email = ?, email_verified = 0 WHERE id = ?', (email, user['id']))
            except sqlite3.IntegrityError:
                self.send_json(409, {'error': 'That email address is already linked to another account.'})
                return
            conn.execute('DELETE FROM email_verifications WHERE user_id = ?', (user['id'],))
            conn.execute('DELETE FROM password_resets WHERE user_id = ?', (user['id'],))
        verification_sent = self.issue_email_verification(user['id'], email)
        self.send_json(200, {'email': email, 'emailVerified': False, 'verificationSent': verification_sent})

    def issue_email_verification(self, user_id, email):
        now = time.time()
        token = secrets.token_urlsafe(32)
        with db_lock, get_db() as conn:
            conn.execute('DELETE FROM email_verifications WHERE user_id = ?', (user_id,))
            conn.execute(
                'INSERT INTO email_verifications (token_hash, user_id, email, expires) VALUES (?, ?, ?, ?)',
                (token_digest(token), user_id, email, now + RESET_SECONDS)
            )
        try:
            self.send_email_verification(email, token)
        except (OSError, RuntimeError, smtplib.SMTPException, ValueError) as error:
            with db_lock, get_db() as conn:
                conn.execute('DELETE FROM email_verifications WHERE token_hash = ?', (token_digest(token),))
            self.log_error('Recovery email verification delivery failed: %s', error)
            return False
        return True

    def api_send_recovery_verification(self):
        if self.read_json() is None:
            self.send_json(400, {'error': 'Invalid request'})
            return
        user = self.current_user()
        if not user:
            self.send_json(401, {'error': 'Not logged in'})
            return
        if not user['email']:
            self.send_json(400, {'error': 'Save a recovery email address first.'})
            return
        if user['email_verified']:
            self.send_json(200, {'message': 'Recovery email is already verified.'})
            return
        if self.issue_email_verification(user['id'], user['email']):
            self.send_json(200, {'message': 'Verification email sent. Check your inbox.'})
        else:
            self.send_json(503, {'error': 'Could not send the verification email. Check server email settings and try again.'})

    def api_verify_email(self):
        body = self.read_json()
        token = str(body.get('token', '')) if body else ''
        if body is None or not token or len(token) > 200:
            self.send_json(400, {'error': 'This verification link is invalid or expired. Request a new one.'})
            return
        with db_lock, get_db() as conn:
            verification = conn.execute(
                'SELECT user_id, email FROM email_verifications WHERE token_hash = ? AND expires > ?',
                (token_digest(token), time.time())
            ).fetchone()
            if not verification:
                self.send_json(400, {'error': 'This verification link is invalid or expired. Request a new one.'})
                return
            updated = conn.execute(
                'UPDATE users SET email_verified = 1 WHERE id = ? AND email = ?',
                (verification['user_id'], verification['email'])
            )
            conn.execute('DELETE FROM email_verifications WHERE user_id = ?', (verification['user_id'],))
            if updated.rowcount != 1:
                self.send_json(400, {'error': 'This verification link is invalid or expired. Request a new one.'})
                return
        self.send_json(200, {'message': 'Recovery email verified.'})

    def api_forgot_password(self):
        body = self.read_json()
        email = str(body.get('email', '')).strip().lower() if body else ''
        if body is None or len(email) > 254 or not EMAIL_RE.match(email):
            self.send_json(400, {'error': 'Enter a valid email address.'})
            return

        now = time.time()
        ip = self.client_ip()
        attempts = [t for t in reset_attempts.get(ip, []) if t > now - 900]
        if len(attempts) >= 6:
            self.send_json(429, {'error': 'Too many requests. Try again in a few minutes.'})
            return
        attempts.append(now)
        reset_attempts[ip] = attempts

        token = secrets.token_urlsafe(32)
        with db_lock, get_db() as conn:
            row = conn.execute('SELECT id FROM users WHERE email = ? AND email_verified = 1', (email,)).fetchone()
            if row:
                conn.execute('DELETE FROM password_resets WHERE user_id = ?', (row['id'],))
                conn.execute('INSERT INTO password_resets (token_hash, user_id, expires) VALUES (?, ?, ?)',
                             (token_digest(token), row['id'], now + RESET_SECONDS))

        if row:
            try:
                self.send_password_reset_email(email, token)
            except (OSError, RuntimeError, smtplib.SMTPException, ValueError) as error:
                with db_lock, get_db() as conn:
                    conn.execute('DELETE FROM password_resets WHERE token_hash = ?', (token_digest(token),))
                self.log_error('Password reset email delivery failed: %s', error)

        self.send_json(200, {
            'message': 'If an account uses that email address, a password reset link will arrive shortly.'
        })

    def send_password_reset_email(self, email, token):
        reset_url = self.email_action_url('reset', token)
        self.send_email(
            email,
            'Reset your Hockey Soundboard password',
            'Use this one-time link to reset your Hockey Soundboard password. '
            f'It expires in 30 minutes:\n\n{reset_url}\n\n'
            'If you did not request this, you can ignore this email.'
        )

    def send_email_verification(self, email, token):
        verify_url = self.email_action_url('verify', token)
        self.send_email(
            email,
            'Verify your Hockey Soundboard recovery email',
            'Use this one-time link to verify your Hockey Soundboard recovery email. '
            f'It expires in 30 minutes:\n\n{verify_url}\n\n'
            'If you did not request this, you can ignore this email.'
        )

    def email_action_url(self, action, token):
        public_url = os.environ.get('SOUNDBOARD_PUBLIC_URL', '').strip().rstrip('/')
        if not public_url:
            raise RuntimeError('Password recovery email is not configured on the server.')
        parsed_url = urlsplit(public_url)
        if parsed_url.scheme not in ('http', 'https') or not parsed_url.netloc:
            raise ValueError('SOUNDBOARD_PUBLIC_URL must be an absolute HTTP(S) URL.')
        if parsed_url.scheme != 'https' and parsed_url.hostname not in ('localhost', '127.0.0.1'):
            raise ValueError('SOUNDBOARD_PUBLIC_URL must use HTTPS.')
        return f'{public_url}/?{action}={token}'

    def send_email(self, email, subject, content):
        provider = os.environ.get('SOUNDBOARD_EMAIL_PROVIDER', 'smtp').strip().lower()
        if provider == 'graph':
            send_graph_email(email, subject, content)
            return
        if provider != 'smtp':
            raise RuntimeError('SOUNDBOARD_EMAIL_PROVIDER must be "smtp" or "graph".')

        host = os.environ.get('SOUNDBOARD_SMTP_HOST', '').strip()
        sender = os.environ.get('SOUNDBOARD_SMTP_FROM', '').strip()
        if not host or not sender:
            raise RuntimeError('Password recovery email is not configured on the server.')

        message = EmailMessage()
        message['Subject'] = subject
        message['From'] = sender
        message['To'] = email
        message.set_content(content)

        port = int(os.environ.get('SOUNDBOARD_SMTP_PORT', '587'))
        username = os.environ.get('SOUNDBOARD_SMTP_USER', '')
        password = os.environ.get('SOUNDBOARD_SMTP_PASSWORD', '')
        use_ssl = os.environ.get('SOUNDBOARD_SMTP_SSL', '').lower() in ('1', 'true', 'yes')
        context = ssl.create_default_context()
        if use_ssl:
            with smtplib.SMTP_SSL(host, port, context=context, timeout=15) as smtp:
                if username:
                    smtp.login(username, password)
                smtp.send_message(message)
        else:
            with smtplib.SMTP(host, port, timeout=15) as smtp:
                smtp.starttls(context=context)
                if username:
                    smtp.login(username, password)
                smtp.send_message(message)


    def api_reset_password(self):
        body = self.read_json()
        token = str(body.get('token', '')) if body else ''
        password = str(body.get('password', '')) if body else ''
        if body is None or not token or len(token) > 200:
            self.send_json(400, {'error': 'This reset link is invalid or expired. Request a new one.'})
            return
        if len(password) < 8 or len(password) > 200:
            self.send_json(400, {'error': 'Password must be at least 8 characters.'})
            return

        now = time.time()
        ip = self.client_ip()
        attempts = [t for t in reset_password_attempts.get(ip, []) if t > now - 900]
        if len(attempts) >= 8:
            self.send_json(429, {'error': 'Too many attempts. Request a new reset link and try again later.'})
            return
        attempts.append(now)
        reset_password_attempts[ip] = attempts

        salt = secrets.token_bytes(16)
        pw_hash = hash_password(password, salt)
        with db_lock, get_db() as conn:
            reset = conn.execute(
                'SELECT user_id FROM password_resets WHERE token_hash = ? AND expires > ?',
                (token_digest(token), time.time())
            ).fetchone()
            if not reset:
                self.send_json(400, {'error': 'This reset link is invalid or expired. Request a new one.'})
                return
            conn.execute('UPDATE users SET salt = ?, hash = ? WHERE id = ?', (salt, pw_hash, reset['user_id']))
            conn.execute('DELETE FROM password_resets WHERE user_id = ?', (reset['user_id'],))
            conn.execute('DELETE FROM sessions WHERE user_id = ?', (reset['user_id'],))
            user = conn.execute(
                'SELECT id, username, email, email_verified FROM users WHERE id = ?',
                (reset['user_id'],)
            ).fetchone()
            cookie = self.start_session(conn, user['id'])
        self.send_json(200, {
            'id': user['id'],
            'username': user['username'],
            'email': user['email'] or '',
            'emailVerified': bool(user['email_verified'])
        }, [cookie])

    def api_logout(self):
        if self.read_json() is None:
            self.send_json(400, {'error': 'Invalid request'})
            return
        header = self.headers.get('Cookie', '')
        jar = cookies.SimpleCookie()
        try:
            jar.load(header)
        except cookies.CookieError:
            pass
        morsel = jar.get(SESSION_COOKIE)
        if morsel:
            with db_lock, get_db() as conn:
                conn.execute('DELETE FROM sessions WHERE token_hash = ?', (token_digest(morsel.value),))
        self.send_json(200, {'ok': True}, [self.session_cookie('', 0)])

    def api_get_data(self):
        user = self.current_user()
        if not user:
            self.send_json(401, {'error': 'Not logged in'})
            return
        with db_lock, get_db() as conn:
            rows = conn.execute('SELECT key, value FROM user_data WHERE user_id = ?', (user['id'],)).fetchall()
        self.send_json(200, {'data': {row['key']: row['value'] for row in rows}})

    def api_put_data(self):
        user = self.current_user()
        if not user:
            self.send_json(401, {'error': 'Not logged in'})
            return
        body = self.read_json()
        changes = body.get('changes') if body else None
        if not isinstance(changes, dict) or len(changes) > 50:
            self.send_json(400, {'error': 'Invalid request'})
            return
        for key, value in changes.items():
            if not key.startswith('hockey-soundboard-') or len(key) > 100 or not (value is None or isinstance(value, str)):
                self.send_json(400, {'error': 'Invalid data'})
                return
        with db_lock, get_db() as conn:
            for key, value in changes.items():
                if value is None:
                    conn.execute('DELETE FROM user_data WHERE user_id = ? AND key = ?', (user['id'], key))
                else:
                    conn.execute('INSERT INTO user_data (user_id, key, value) VALUES (?, ?, ?) '
                                 'ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value',
                                 (user['id'], key, value))
        self.send_json(200, {'ok': True})

    def api_shared_list(self):
        user = self.current_user()
        if not user:
            self.send_json(401, {'error': 'Not logged in'})
            return
        with db_lock, get_db() as conn:
            config = read_config(conn)
            rows = conn.execute(
                'SELECT c.id, c.key, c.name, c.tracks, c.updated, c.owner_id, u.username FROM shared_categories c '
                'JOIN users u ON u.id = c.owner_id ORDER BY c.name COLLATE NOCASE'
            ).fetchall()
        categories = []
        for row in rows:
            tracks = json.loads(row['tracks'])
            enabled_tracks = [track for track in tracks if track_enabled(track, config)]
            if tracks and not enabled_tracks:
                continue
            categories.append({
                'id': row['id'], 'key': row['key'], 'name': row['name'],
                'owner': row['username'], 'mine': row['owner_id'] == user['id'],
                'trackCount': len(enabled_tracks), 'updated': row['updated']
            })
        self.send_json(200, {'categories': categories})

    def api_google_sheet(self):
        if not self.current_user():
            self.send_json(401, {'error': 'Not logged in'})
            return
        query = parse_qs(urlparse(self.path).query)
        sheet_id = query.get('id', [''])[0]
        gid = query.get('gid', ['0'])[0]
        if not re.fullmatch(r'[A-Za-z0-9_-]{20,100}', sheet_id) or not re.fullmatch(r'\d{1,12}', gid):
            self.send_json(400, {'error': 'That does not look like a Google Sheets link.'})
            return
        url = f'https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}'
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'HockeySoundboard'}), timeout=15) as response:
                content_type = response.headers.get('Content-Type', '')
                data = response.read(2_000_000)
        except (urllib.error.URLError, TimeoutError, OSError):
            self.send_json(502, {'error': 'Could not read the Google Sheet. Set sharing to "Anyone with the link can view".'})
            return
        if 'csv' not in content_type.lower():
            self.send_json(403, {'error': 'The Google Sheet is private. Set sharing to "Anyone with the link can view".'})
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/csv; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)
    def api_shared_get(self):
        user = self.current_user()
        if not user:
            self.send_json(401, {'error': 'Not logged in'})
            return
        try:
            category_id = int(parse_qs(urlparse(self.path).query).get('id', [''])[0])
        except ValueError:
            self.send_json(400, {'error': 'Invalid category'})
            return
        with db_lock, get_db() as conn:
            config = read_config(conn)
            row = conn.execute(
                'SELECT c.name, c.tracks, u.username FROM shared_categories c JOIN users u ON u.id = c.owner_id '
                'WHERE c.id = ?', (category_id,)
            ).fetchone()
        if not row:
            self.send_json(404, {'error': 'That shared category is no longer available.'})
            return
        self.send_json(200, {'name': row['name'], 'owner': row['username'],
                             'tracks': [track for track in json.loads(row['tracks']) if track_enabled(track, config)]})

    def api_shared_publish(self):
        user = self.current_user()
        if not user:
            self.send_json(401, {'error': 'Not logged in'})
            return
        body = self.read_json()
        key = body.get('key') if body else None
        name = body.get('name') if body else None
        tracks = body.get('tracks') if body else None
        if (not isinstance(key, str) or not key.strip() or len(key) > 100
                or not isinstance(name, str) or not name.strip() or len(name) > 100
                or not isinstance(tracks, list) or len(tracks) > MAX_SHARED_TRACKS):
            self.send_json(400, {'error': 'Invalid category'})
            return
        clean = [sanitize_shared_track(track) for track in tracks]
        clean = [track for track in clean if track]
        with db_lock, get_db() as conn:
            conn.execute(
                'INSERT INTO shared_categories (owner_id, key, name, tracks, updated) VALUES (?, ?, ?, ?, ?) '
                'ON CONFLICT(owner_id, key) DO UPDATE SET name = excluded.name, tracks = excluded.tracks, '
                'updated = excluded.updated',
                (user['id'], key.strip(), name.strip(), json.dumps(clean), time.time())
            )
        self.send_json(200, {'ok': True, 'shared': len(clean), 'skipped': len(tracks) - len(clean)})

    def api_shared_unshare(self):
        user = self.current_user()
        if not user:
            self.send_json(401, {'error': 'Not logged in'})
            return
        body = self.read_json()
        key = body.get('key') if body else None
        if not isinstance(key, str):
            self.send_json(400, {'error': 'Invalid category'})
            return
        with db_lock, get_db() as conn:
            conn.execute('DELETE FROM shared_categories WHERE owner_id = ? AND key = ?', (user['id'], key))
        self.send_json(200, {'ok': True})

    def end_headers(self):
        if not self.path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


def main():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    init_db()
    port = int(os.environ.get('PORT') or os.environ.get('WEBSITES_PORT') or (sys.argv[1] if len(sys.argv) > 1 else 8000))
    host = os.environ.get('SOUNDBOARD_HOST', '0.0.0.0')
    server = ThreadingHTTPServer((host, port), Handler)
    print(f'Hockey Soundboard running at http://localhost:{port}/ (bound to {host})')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    if sys.argv[1:] == ['--authorize-email']:
        authorize_graph_email()
    else:
        main()
