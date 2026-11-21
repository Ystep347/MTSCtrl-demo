"""Verify readiness and an actual generated answer through the Python service."""
import sys
import httpx
from app import Settings

settings = Settings.from_environment()
headers = {'Authorization': 'Bearer ' + settings.key}
try:
    with httpx.Client(base_url='http://127.0.0.1:8001', headers=headers, timeout=90, trust_env=False) as client:
        response = client.get('/health')
        response.raise_for_status()
        print('Сервис доступен. Модель:', response.json()['model'])
        response = client.post('/ask', json={'question': 'Кто решает INC000021931151?', 'history': [], 'context': {
            'statistics': {'total': 1, 'active': 1},
            'incidents': [{'id': 'INC000021931151', 'title': 'Тест подключения по одной записи',
                           'team': 'КЦ ИТ Координаторы Массовых Инцидентов',
                           'assignee': 'Дядя Фёдор (unclefedor)', 'status': 'Назначен'}]}})
        response.raise_for_status()
        data = response.json()
        if data.get('provider') != 'ollama' or not data.get('answer'):
            raise ValueError('Сервис не вернул ответ модели.')
        print('Получен настоящий ответ локальной модели:')
        print(data['answer'])
except (httpx.HTTPError, ValueError, KeyError) as error:
    print('Проверка не прошла. Проверьте Ollama, скачанную модель и запущенный сервис.')
    print(type(error).__name__)
    sys.exit(1)
