import sys
import time


def took(name: str, started: float) -> None:
    sys.stderr.write(f"seed: {name} took {time.monotonic() - started:.0f} s\n")
    sys.stderr.flush()


class Timed:
    def __init__(self, name: str) -> None:
        self.name = name
        self.started = time.monotonic()

    def __enter__(self) -> None:
        self.started = time.monotonic()

    def __exit__(self, *_: object) -> None:
        took(self.name, self.started)
