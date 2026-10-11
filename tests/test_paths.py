import unittest
from pathlib import Path
from unittest import mock

from camelopard import paths


class PathsTest(unittest.TestCase):

    def on(
            self,
            platform,
            environ
    ):
        return mock.patch.multiple(
            "camelopard.paths",
            sys=mock.Mock(platform=platform),
            os=mock.Mock(environ=environ, path=paths.os.path)
        )

    def test_linux_follows_xdg(self):
        with self.on("linux", {"XDG_CONFIG_HOME": "/xdg/config", "XDG_CACHE_HOME": "/xdg/cache"}):
            self.assertEqual(
                paths.default_config_file(),
                Path("/xdg/config/camelopard/config.json")
            )
            self.assertEqual(
                paths.cache_dir(),
                Path("/xdg/cache/camelopard")
            )

    def test_linux_ignores_relative_xdg_value(self):
        with self.on("linux", {"XDG_CACHE_HOME": "relative"}):
            self.assertEqual(
                paths.cache_dir(),
                Path.home() / ".cache" / "camelopard"
            )

    def test_macos(self):
        with self.on("darwin", {}):
            self.assertEqual(
                paths.cache_dir(),
                Path.home() / "Library" / "Caches" / "camelopard"
            )

    def test_windows(self):
        with self.on("win32", {"APPDATA": "C:/Roaming", "LOCALAPPDATA": "C:/Local"}):
            self.assertEqual(
                paths.config_dir(),
                Path("C:/Roaming/camelopard")
            )
            self.assertEqual(
                paths.cache_dir(),
                Path("C:/Local/camelopard/cache")
            )
