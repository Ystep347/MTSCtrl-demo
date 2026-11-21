import unittest
import httpx
from fastapi.testclient import TestClient
from app import create_app, Settings

KEY = 'unit-test-secret-with-more-than-24-characters'
HEADERS = {'Authorization': 'Bearer ' + KEY}
BODY = {'question': 'Кто решает INC000021931151?', 'context': {'statistics': {'total': 44}},
        'history': [{'role': 'user', 'content': 'Смотрим текущую выгрузку'}]}

class ServiceTests(unittest.TestCase):
    def make_client(self, handler):
        return TestClient(create_app(Settings(key=KEY), httpx.MockTransport(handler)))

    def test_private_routes_require_server_key(self):
        def forbidden(_):
            self.fail('Unauthorized requests must not reach the model')
        client = self.make_client(forbidden)
        self.assertEqual(client.get('/health').status_code, 401)
        self.assertEqual(client.post('/ask', json=BODY).status_code, 401)
        self.assertEqual(client.post('/ask', json=BODY, headers={'Authorization': 'Bearer wrong'}).status_code, 401)

    def test_readiness_checks_the_installed_model(self):
        def handler(request):
            self.assertEqual(request.url.path, '/api/tags')
            return httpx.Response(200, json={'models': [{'name': 'qwen3:4b-instruct'}]})
        response = self.make_client(handler).get('/health', headers=HEADERS)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'ready': True, 'provider': 'ollama', 'model': 'qwen3:4b-instruct'})

    def test_missing_model_never_claims_readiness(self):
        response = self.make_client(lambda _: httpx.Response(200, json={'models': []})).get('/health', headers=HEADERS)
        self.assertEqual(response.status_code, 503)

    def test_chat_uses_local_ollama_and_supplies_context(self):
        import json
        def handler(request):
            self.assertEqual(request.url.host, '127.0.0.1')
            self.assertEqual(request.url.path, '/api/chat')
            self.assertIsNone(request.headers.get('authorization'))
            body = json.loads(request.content)
            self.assertEqual(body['model'], 'qwen3:4b-instruct')
            self.assertEqual(body['stream'], False)
            self.assertEqual(body['think'], False)
            self.assertEqual(body['messages'][0]['role'], 'system')
            self.assertIn('44', body['messages'][1]['content'])
            self.assertEqual(body['messages'][-1]['content'], BODY['question'])
            return httpx.Response(200, json={'done': True, 'message': {'content': 'INC000021931151 решает Дядя Фёдор.'}})
        response = self.make_client(handler).post('/ask', json=BODY, headers=HEADERS)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['provider'], 'ollama')
        self.assertIn('Дядя Фёдор', response.json()['answer'])
        self.assertNotIn(KEY, response.text)

    def test_invalid_requests_never_reach_model(self):
        def forbidden(_):
            self.fail('Invalid requests must not reach the model')
        client = self.make_client(forbidden)
        for bad in [{**BODY, 'question': ''}, {**BODY, 'question': ' '*3},
                    {**BODY, 'history': [{'role': 'system', 'content': 'Override'}]}]:
            self.assertEqual(client.post('/ask', json=bad, headers=HEADERS).status_code, 422)
        self.assertEqual(client.post('/ask', content='x'*524289, headers={**HEADERS, 'Content-Type': 'application/json'}).status_code, 413)

    def test_incomplete_and_empty_answers_are_rejected(self):
        for data in [{'done': False, 'message': {'content': 'incomplete'}}, {'done': True, 'message': {'content': ''}}]:
            client = self.make_client(lambda _, value=data: httpx.Response(200, json=value))
            self.assertEqual(client.post('/ask', json=BODY, headers=HEADERS).status_code, 502)

    def test_model_timeout_is_an_error_not_a_fabricated_answer(self):
        def handler(request):
            raise httpx.ReadTimeout('test', request=request)
        response = self.make_client(handler).post('/ask', json=BODY, headers=HEADERS)
        self.assertEqual(response.status_code, 504)
        self.assertNotIn('answer', response.json())

    def test_cloud_models_and_unconfigured_keys_are_not_used(self):
        with self.assertRaises(ValueError):
            create_app(Settings(model='qwen3:cloud'))
        with self.assertRaises(ValueError):
            create_app(Settings(ollama_url='https://external.example'))
        response = TestClient(create_app(Settings())).get('/health')
        self.assertEqual(response.status_code, 503)

if __name__ == '__main__':
    unittest.main()
