"""Settings read from the environment once at start-up."""

import os
from dataclasses import dataclass

MIN_SECRET_LENGTH = 32


@dataclass(frozen=True)
class Settings:
    secret: str
    max_file_bytes: int = 10 * 1_000_000
    job_timeout_seconds: float = 20.0
    max_concurrent_jobs: int = 2
    max_zip_entries: int = 2_000
    max_zip_uncompressed_bytes: int = 100 * 1_000_000
    max_zip_ratio: int = 200
    regex_timeout_seconds: float = 0.5
    max_pattern_length: int = 500

    def __post_init__(self) -> None:
        if len(self.secret) < MIN_SECRET_LENGTH:
            raise ValueError(f"PARSER_SECRET must be at least {MIN_SECRET_LENGTH} characters.")


def settings_from_env() -> Settings:
    secret = os.environ.get("PARSER_SECRET", "")
    return Settings(secret=secret)
