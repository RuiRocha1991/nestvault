"""Errors that carry the HTTP status and a stable code. Messages never contain file content."""


class ParserError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class FileTooLargeError(ParserError):
    def __init__(self, max_bytes: int) -> None:
        super().__init__(413, "file_too_large", f"File is larger than {max_bytes // 1_000_000} MB.")


class UnsupportedFileError(ParserError):
    def __init__(self, message: str = "Unsupported file type.") -> None:
        super().__init__(415, "unsupported_file", message)


class UnsafeArchiveError(ParserError):
    def __init__(self, message: str) -> None:
        super().__init__(422, "unsafe_archive", message)


class UnknownParserError(ParserError):
    def __init__(self) -> None:
        super().__init__(404, "unknown_parser", "No parser with that id.")


class ParseFailedError(ParserError):
    def __init__(self, message: str = "The file could not be parsed.") -> None:
        super().__init__(422, "parse_failed", message)


class JobTimeoutError(ParserError):
    def __init__(self, seconds: float) -> None:
        super().__init__(504, "timeout", f"Processing took longer than {seconds:g} seconds.")
