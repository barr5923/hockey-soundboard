"""App-wide music integration configuration, separate from user settings."""

import json

PROVIDERS = ('spotify', 'youtube', 'appleMusic')
DEFAULT_CONFIG = {
    'enabled': {provider: True for provider in PROVIDERS},
    'spotifyClientId': '',
    'youtubeApiKey': ''
}


def read_config(connection):
    row = connection.execute("SELECT value FROM app_config WHERE key = 'integrations'").fetchone()
    if not row:
        return {**DEFAULT_CONFIG, 'enabled': dict(DEFAULT_CONFIG['enabled'])}
    return json.loads(row['value'])


def public_config(config):
    return {
        'enabled': config['enabled'],
        'spotifyClientId': config['spotifyClientId'],
        'youtubeConfigured': bool(config['youtubeApiKey'])
    }


def validate_update(body, previous):
    if not isinstance(body, dict):
        raise ValueError('Invalid integration configuration.')
    enabled = body.get('enabled')
    if (not isinstance(enabled, dict) or set(enabled) != set(PROVIDERS)
            or any(type(value) is not bool for value in enabled.values())):
        raise ValueError('Each integration must have a true/false enabled value.')
    client_id = body.get('spotifyClientId')
    if not isinstance(client_id, str) or len(client_id) > 128:
        raise ValueError('Invalid shared client ID.')
    api_key = body.get('youtubeApiKey', previous['youtubeApiKey'])
    if not isinstance(api_key, str) or len(api_key) > 256:
        raise ValueError('Invalid shared API key.')
    return {
        'enabled': dict(enabled),
        'spotifyClientId': client_id.strip(),
        'youtubeApiKey': api_key.strip()
    }


def track_enabled(track, config):
    if track.get('audioDataUrl') or track.get('audioStorageId') or track.get('audioUrl'):
        return True
    if track.get('youtubeUrl') or track.get('youtubeEmbedUrl'):
        return config['enabled']['youtube']
    if track.get('spotifyUrl'):
        return config['enabled']['spotify']
    if track.get('appleMusicUrl'):
        return config['enabled']['appleMusic']
    return True
