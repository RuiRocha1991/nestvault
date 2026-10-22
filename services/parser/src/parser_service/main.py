from .app import create_app
from .config import settings_from_env

app = create_app(settings_from_env())
