from __future__ import annotations

import logging

from .config import settings


def configure_logging() -> None:
    if getattr(configure_logging, "_configured", False):
        return

    settings.log_path.parent.mkdir(parents=True, exist_ok=True)
    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)

    file_handler = logging.FileHandler(settings.log_path)
    file_handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.setLevel(level)
    root_logger.addHandler(stream_handler)
    root_logger.addHandler(file_handler)

    configure_logging._configured = True
