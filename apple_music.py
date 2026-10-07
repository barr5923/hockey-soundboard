"""Server-side Apple Music developer token generation."""

import os
import re
import time

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


class AppleMusicConfigurationError(ValueError):
    pass


def create_developer_token(public_root: str) -> str:
    team_id = os.environ.get('SOUNDBOARD_APPLE_TEAM_ID', '')
    key_id = os.environ.get('SOUNDBOARD_APPLE_KEY_ID', '')
    key_path = os.environ.get('SOUNDBOARD_APPLE_PRIVATE_KEY_PATH', '')
    if not re.fullmatch(r'[A-Z0-9]{10}', team_id) or not re.fullmatch(r'[A-Z0-9]{10}', key_id) or not key_path:
        raise AppleMusicConfigurationError(
            'Apple Music is not configured. Set the server Apple Team ID, Key ID, and private key path.'
        )
    root = os.path.normcase(os.path.realpath(public_root))
    path = os.path.normcase(os.path.realpath(key_path))
    if not os.path.isabs(key_path):
        raise AppleMusicConfigurationError('The Apple Music private key path must be absolute.')
    try:
        inside_public_root = os.path.commonpath([root, path]) == root
    except ValueError:
        inside_public_root = False
    if inside_public_root:
        raise AppleMusicConfigurationError('Store the Apple Music private key outside the publicly served app folder.')
    try:
        with open(path, 'rb') as key_file:
            key = serialization.load_pem_private_key(key_file.read(), password=None)
    except (OSError, ValueError, TypeError) as error:
        raise AppleMusicConfigurationError('The server could not read a valid Apple Music signing key.') from error
    if not isinstance(key, ec.EllipticCurvePrivateKey) or not isinstance(key.curve, ec.SECP256R1):
        raise AppleMusicConfigurationError('Apple Music requires an ES256 (P-256) signing key.')
    now = int(time.time())
    return jwt.encode(
        {'iss': team_id, 'iat': now, 'exp': now + 3600},
        key, algorithm='ES256', headers={'kid': key_id}
    )
