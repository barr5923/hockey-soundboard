import json
import os
import sqlite3
import tempfile
import threading
import unittest
import urllib.request
from contextlib import contextmanager
from itertools import product
from http.server import ThreadingHTTPServer
from unittest.mock import Mock, patch

import server
from integrations import PROVIDERS, track_enabled


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = os.path.join(directory.name, 'users.db')

        @contextmanager
        def database():
            connection = sqlite3.connect(self.path)
            connection.row_factory = sqlite3.Row
            try:
                with connection:
                    yield connection
            finally:
                connection.close()

        patcher = patch.object(server, 'get_db', database)
        patcher.start()
        self.addCleanup(patcher.stop)
        server.init_db()
        self.admin = {'id': 1, 'is_admin': True}
        self.user = {'id': 2, 'is_admin': False}

    def call(self, method, user=None, body=None, path='/api/integrations'):
        handler = server.Handler.__new__(server.Handler)
        handler.path = path
        handler.headers = {}
        handler.current_user = lambda: user
        handler.read_json = lambda: body
        handler.send_json = Mock()
        handler.log_error = Mock()
        getattr(handler, method)()
        return handler.send_json.call_args.args

    def save(self, flags, **extra):
        return self.call('api_save_integrations', self.admin, {
            'enabled': dict(zip(PROVIDERS, flags)), 'spotifyClientId': 'shared-client', **extra
        })

    def test_only_admin_can_update_settings(self):
        for user, expected in [(None, 401), (self.user, 403)]:
            self.assertEqual(self.call('api_save_integrations', user, {})[0], expected)
            self.assertEqual(self.call('api_admin_integrations', user)[0], expected)

    def test_all_eight_combinations_persist_and_are_app_wide(self):
        for flags in product([False, True], repeat=3):
            self.assertEqual(self.save(flags)[0], 200)
            # Read through a new connection, as another user and without login for help.
            for user in [self.user, None]:
                status, config = self.call('api_integrations', user)
                self.assertEqual(status, 200)
                self.assertEqual(config['enabled'], dict(zip(PROVIDERS, flags)))
            for provider, field in [('spotify', 'spotifyUrl'), ('youtube', 'youtubeUrl'), ('appleMusic', 'appleMusicUrl')]:
                self.assertEqual(track_enabled({field: 'https://example.com/song'}, config), config['enabled'][provider])
            self.assertTrue(track_enabled({'audioStorageId': 'mp3'}, config))

    def test_secrets_are_not_returned_and_omission_preserves_key(self):
        self.save((True, True, True), youtubeApiKey='server-only-secret')
        for method, user in [('api_integrations', None), ('api_admin_integrations', self.admin)]:
            _, payload = self.call(method, user)
            self.assertTrue(payload['youtubeConfigured'])
            self.assertNotIn('server-only-secret', json.dumps(payload))
            self.assertNotIn('youtubeApiKey', payload)
        self.save((False, False, False))
        self.assertTrue(self.call('api_integrations')[1]['youtubeConfigured'])
        self.save((True, True, True), youtubeApiKey='')
        self.assertFalse(self.call('api_integrations')[1]['youtubeConfigured'])

    def test_google_client_id_is_public_preserved_and_validated(self):
        self.assertEqual(self.call('api_integrations')[1]['googleClientId'], '')
        client_id = '1234-abc.apps.googleusercontent.com'
        self.assertEqual(self.save((True, True, True), googleClientId=f' {client_id} ')[0], 200)
        self.assertEqual(self.call('api_integrations', None)[1]['googleClientId'], client_id)
        self.save((True, False, True))
        self.assertEqual(self.call('api_integrations')[1]['googleClientId'], client_id)
        for bad in [12, 'x' * 257, 'bad id<script>']:
            self.assertEqual(self.save((True, True, True), googleClientId=bad)[0], 400)
        self.assertEqual(self.call('api_integrations')[1]['googleClientId'], client_id)
        self.save((True, True, True), googleClientId='')
        self.assertEqual(self.call('api_integrations')[1]['googleClientId'], '')

    def test_invalid_updates_do_not_change_previous_config(self):
        self.save((True, False, True))
        previous = self.call('api_integrations')[1]
        for body in [None, {}, {'enabled': {'spotify': 'false'}, 'spotifyClientId': ''},
                     {'enabled': {key: True for key in PROVIDERS}, 'spotifyClientId': None},
                     {'enabled': {key: True for key in PROVIDERS}, 'spotifyClientId': '', 'youtubeApiKey': 12}]:
            self.assertEqual(self.call('api_save_integrations', self.admin, body)[0], 400)
            self.assertEqual(self.call('api_integrations')[1], previous)

    def test_disabled_endpoints_never_request_provider_or_sign_tokens(self):
        self.save((False, False, False), youtubeApiKey='secret')
        with patch.object(server.urllib.request, 'urlopen') as request, patch.object(server, 'create_developer_token') as sign:
            self.assertEqual(self.call('api_youtube', self.user, path='/api/youtube?resource=playlistItems&playlistId=PLtest')[0], 403)
            self.assertEqual(self.call('api_apple_music_token', self.user)[0], 403)
            request.assert_not_called()
            sign.assert_not_called()

    def test_youtube_requires_login_key_and_valid_fixed_resource(self):
        self.assertEqual(self.call('api_youtube')[0], 401)
        self.assertEqual(self.call('api_youtube', self.user)[0], 503)
        self.save((True, True, True), youtubeApiKey='secret')
        for query in ['resource=https://example.com', 'resource=videos&id=bad',
                      'resource=playlistItems&playlistId=http://example.com']:
            self.assertEqual(self.call('api_youtube', self.user, path=f'/api/youtube?{query}')[0], 400)
        response = Mock()
        response.read.return_value = b'{"items": []}'
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        with patch.object(server.urllib.request, 'urlopen', return_value=response) as request:
            status, payload = self.call('api_youtube', self.user, path='/api/youtube?resource=playlistItems&playlistId=PLtest')
            self.assertEqual((status, payload), (200, {'items': []}))
            self.assertTrue(request.call_args.args[0].full_url.startswith('https://www.googleapis.com/youtube/v3/playlistItems?'))
            self.assertNotIn('secret', json.dumps(payload))

    def test_disabling_shared_songs_hides_without_deleting_them(self):
        self.call('api_shared_publish', self.admin, {
            'key': 'test', 'name': 'Test', 'tracks': [
                {'name': 'Remote', 'spotifyUrl': 'https://open.spotify.com/track/one'}
            ]
        })
        category = self.call('api_shared_list', self.user)[1]['categories'][0]
        self.save((False, True, True))
        self.assertEqual(self.call('api_shared_list', self.user)[1]['categories'], [])
        self.assertEqual(self.call('api_shared_get', self.user, path=f"/api/shared-category?id={category['id']}")[1]['tracks'], [])
        self.save((True, True, True))
        self.assertEqual(self.call('api_shared_list', self.user)[1]['categories'][0]['trackCount'], 1)
        self.assertEqual(len(self.call('api_shared_get', self.user, path=f"/api/shared-category?id={category['id']}")[1]['tracks']), 1)

    def test_live_http_admin_save_and_public_configuration(self):
        httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever)
        thread.start()
        base = f'http://127.0.0.1:{httpd.server_port}'
        try:
            login = urllib.request.Request(
                f'{base}/api/login',
                data=json.dumps({'username': 'admin', 'password': 'admin'}).encode(),
                headers={'Content-Type': 'application/json'}, method='POST'
            )
            with urllib.request.urlopen(login, timeout=5) as response:
                cookie = response.headers['Set-Cookie'].split(';')[0]
            update = urllib.request.Request(
                f'{base}/api/admin/integrations',
                data=json.dumps({
                    'enabled': {'spotify': True, 'youtube': True, 'appleMusic': False},
                    'spotifyClientId': 'shared-client', 'youtubeApiKey': 'http-test-secret'
                }).encode(),
                headers={'Content-Type': 'application/json', 'Cookie': cookie}, method='PUT'
            )
            with urllib.request.urlopen(update, timeout=5) as response:
                self.assertEqual(response.headers['Cache-Control'], 'no-store')
                self.assertFalse(json.load(response)['enabled']['appleMusic'])
            with urllib.request.urlopen(f'{base}/api/integrations', timeout=5) as response:
                config = json.load(response)
                self.assertTrue(config['youtubeConfigured'])
                self.assertNotIn('http-test-secret', json.dumps(config))
                self.assertFalse(config['enabled']['appleMusic'])
        finally:
            httpd.shutdown()
            thread.join()
            httpd.server_close()


if __name__ == '__main__':
    unittest.main()
