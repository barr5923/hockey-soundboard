import os
import tempfile
import unittest
from unittest.mock import Mock, patch

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

import apple_music
import server


class AppleMusicTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = os.path.join(directory.name, 'public')
        os.mkdir(self.root)
        self.key_path = os.path.join(directory.name, 'AuthKey_test.p8')
        self.key = ec.generate_private_key(ec.SECP256R1())
        with open(self.key_path, 'wb') as key_file:
            key_file.write(self.key.private_bytes(
                serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption()
            ))
        patcher = patch.dict(os.environ, {
            'SOUNDBOARD_APPLE_TEAM_ID': 'ABCDEFGHIJ',
            'SOUNDBOARD_APPLE_KEY_ID': '0123456789',
            'SOUNDBOARD_APPLE_PRIVATE_KEY_PATH': self.key_path
        })
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_signed_token_has_one_hour_expiry_and_key_id(self):
        token = apple_music.create_developer_token(self.root)
        payload = jwt.decode(token, self.key.public_key(), algorithms=['ES256'], issuer='ABCDEFGHIJ')
        self.assertEqual(payload['exp'] - payload['iat'], 3600)
        self.assertEqual(jwt.get_unverified_header(token)['kid'], '0123456789')

    def test_missing_configuration_is_explicit(self):
        with patch.dict(os.environ, {'SOUNDBOARD_APPLE_TEAM_ID': ''}):
            with self.assertRaisesRegex(apple_music.AppleMusicConfigurationError, 'not configured'):
                apple_music.create_developer_token(self.root)

    def test_private_key_inside_public_folder_is_rejected(self):
        with patch.dict(os.environ, {'SOUNDBOARD_APPLE_PRIVATE_KEY_PATH': os.path.join(self.root, 'key.p8')}):
            with self.assertRaisesRegex(apple_music.AppleMusicConfigurationError, 'outside'):
                apple_music.create_developer_token(self.root)

    def test_missing_and_invalid_keys_do_not_expose_path_or_key(self):
        os.remove(self.key_path)
        with self.assertRaisesRegex(apple_music.AppleMusicConfigurationError, 'could not read'):
            apple_music.create_developer_token(self.root)
        with open(self.key_path, 'w', encoding='utf-8') as key_file:
            key_file.write('not a key')
        with self.assertRaisesRegex(apple_music.AppleMusicConfigurationError, 'could not read'):
            apple_music.create_developer_token(self.root)

    def test_wrong_curve_is_rejected(self):
        key = ec.generate_private_key(ec.SECP384R1())
        with open(self.key_path, 'wb') as key_file:
            key_file.write(key.private_bytes(
                serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption()
            ))
        with self.assertRaisesRegex(apple_music.AppleMusicConfigurationError, 'P-256'):
            apple_music.create_developer_token(self.root)

    def test_endpoint_requires_login_and_reports_configuration_errors(self):
        config_patcher = patch.object(server, 'read_config', return_value={'enabled': {'appleMusic': True}})
        config_patcher.start()
        self.addCleanup(config_patcher.stop)
        database_patcher = patch.object(server, 'get_db')
        database_patcher.start()
        self.addCleanup(database_patcher.stop)
        handler = server.Handler.__new__(server.Handler)
        handler.current_user = Mock(return_value=None)
        handler.send_json = Mock()
        handler.log_error = Mock()
        handler.api_apple_music_token()
        self.assertEqual(handler.send_json.call_args.args[0], 401)
        handler.current_user.return_value = {'id': 1}
        with patch.object(server, 'create_developer_token', side_effect=apple_music.AppleMusicConfigurationError('Not configured')):
            handler.api_apple_music_token()
        self.assertEqual(handler.send_json.call_args.args, (503, {'error': 'Not configured'}))
        with patch.object(server, 'create_developer_token', return_value='test-token'):
            handler.api_apple_music_token()
        self.assertEqual(handler.send_json.call_args.args, (200, {'token': 'test-token'}))

    def test_sharing_keeps_apple_music_links_and_metadata(self):
        track = server.sanitize_shared_track({
            'name': 'Song', 'description': 'Artist', 'durationSeconds': 123,
            'appleMusicUrl': 'https://music.apple.com/us/song/123'
        })
        self.assertIsNotNone(track)
        self.assertEqual(track['appleMusicUrl'], 'https://music.apple.com/us/song/123')
        self.assertEqual(track['durationSeconds'], 123)


if __name__ == '__main__':
    unittest.main()
