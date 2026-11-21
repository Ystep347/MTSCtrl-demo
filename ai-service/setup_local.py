"""Create a local key without printing it or overwriting existing settings."""
from pathlib import Path
import secrets

path = Path(__file__).with_name('.env')
try:
    with path.open('x', encoding='utf-8') as file:
        file.write('AI_SERVICE_KEY=' + secrets.token_urlsafe(32) + '\n')
        file.write('OLLAMA_BASE_URL=http://127.0.0.1:11434\n')
        file.write('OLLAMA_MODEL=qwen3:4b-instruct\n')
except FileExistsError:
    print('Настройки уже существуют; файл не изменён.')
else:
    print('Настройки и секрет сервиса созданы. Значение секрета не выводится.')
print('Запуск: python -m uvicorn app:app --host 127.0.0.1 --port 8001')
