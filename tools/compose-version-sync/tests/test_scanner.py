from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from compose_version_sync.scanner import (
    discover_compose_files,
    normalize_image_name,
    parse_compose_services,
    parse_image_ref,
    scan,
    update_compose_file,
)


class TestParseImageRef:
    def test_image_with_tag(self):
        assert parse_image_ref("nginx:1.25") == ("nginx", "1.25")

    def test_image_without_tag(self):
        assert parse_image_ref("nginx") == ("nginx", "latest")

    def test_image_with_registry_and_tag(self):
        assert parse_image_ref("ghcr.io/org/app:v2.0") == ("ghcr.io/org/app", "v2.0")

    def test_image_with_digest(self):
        repo, digest = parse_image_ref("nginx@sha256:abc123")
        assert repo == "nginx"
        assert digest == "sha256:abc123"

    def test_image_with_port_in_registry(self):
        assert parse_image_ref("registry.example.com:5000/app:v1") == (
            "registry.example.com:5000/app", "v1"
        )


class TestNormalizeImageName:
    def test_strips_docker_io(self):
        assert normalize_image_name("docker.io/library/nginx") == "nginx"

    def test_strips_library(self):
        assert normalize_image_name("library/nginx") == "nginx"

    def test_leaves_custom_registry(self):
        assert normalize_image_name("ghcr.io/org/app") == "ghcr.io/org/app"


class TestDiscoverComposeFiles:
    def test_finds_compose_yaml(self, tmp_path):
        stack = tmp_path / "mystack"
        stack.mkdir()
        (stack / "compose.yaml").write_text("services: {}")

        result = discover_compose_files(tmp_path)
        assert "mystack" in result
        assert result["mystack"] == stack / "compose.yaml"

    def test_finds_docker_compose_yml_fallback(self, tmp_path):
        stack = tmp_path / "mystack"
        stack.mkdir()
        (stack / "docker-compose.yml").write_text("services: {}")

        result = discover_compose_files(tmp_path)
        assert "mystack" in result

    def test_skips_non_directories(self, tmp_path):
        (tmp_path / "not-a-stack.txt").write_text("hello")
        result = discover_compose_files(tmp_path)
        assert len(result) == 0

    def test_nonexistent_dir(self, tmp_path):
        result = discover_compose_files(tmp_path / "nope")
        assert len(result) == 0


class TestParseComposeServices:
    def test_basic_services(self, tmp_path):
        compose = tmp_path / "compose.yaml"
        compose.write_text(
            "services:\n"
            "  web:\n"
            "    image: nginx:1.25\n"
            "  db:\n"
            "    image: postgres:16\n"
        )
        result = parse_compose_services(compose)
        assert result == {"web": "nginx:1.25", "db": "postgres:16"}

    def test_service_without_image(self, tmp_path):
        compose = tmp_path / "compose.yaml"
        compose.write_text(
            "services:\n"
            "  app:\n"
            "    build: .\n"
        )
        result = parse_compose_services(compose)
        assert result == {}


class TestScan:
    def _make_stacks(self, tmp_path):
        stack = tmp_path / "mystack"
        stack.mkdir()
        (stack / "compose.yaml").write_text(
            "services:\n"
            "  web:\n"
            "    image: nginx:1.24\n"
        )
        return tmp_path

    def _mock_container(self, project, service, image_tag):
        container = MagicMock()
        container.labels = {
            "com.docker.compose.project": project,
            "com.docker.compose.service": service,
        }
        container.name = f"{project}-{service}-1"
        container.status = "running"
        container.image.tags = [image_tag]
        container.image.id = "sha256:abc"
        container.image.attrs = {"RepoDigests": []}
        container.attrs = {"Config": {"Image": image_tag}}
        return container

    @patch("compose_version_sync.scanner.docker")
    def test_detects_mismatch(self, mock_docker, tmp_path):
        stacks = self._make_stacks(tmp_path)
        client = MagicMock()
        mock_docker.from_env.return_value = client
        client.containers.list.return_value = [
            self._mock_container("mystack", "web", "nginx:1.25")
        ]

        result = scan(stacks)
        assert len(result.mismatches) == 1
        assert result.mismatches[0].compose_image == "nginx:1.24"
        assert result.mismatches[0].running_image == "nginx:1.25"

    @patch("compose_version_sync.scanner.docker")
    def test_detects_match(self, mock_docker, tmp_path):
        stacks = self._make_stacks(tmp_path)
        client = MagicMock()
        mock_docker.from_env.return_value = client
        client.containers.list.return_value = [
            self._mock_container("mystack", "web", "nginx:1.24")
        ]

        result = scan(stacks)
        assert len(result.mismatches) == 0
        assert len(result.matched) == 1

    @patch("compose_version_sync.scanner.docker")
    def test_unmatched_service(self, mock_docker, tmp_path):
        stacks = self._make_stacks(tmp_path)
        client = MagicMock()
        mock_docker.from_env.return_value = client
        client.containers.list.return_value = []

        result = scan(stacks)
        assert len(result.unmatched_services) == 1
        assert result.unmatched_services[0]["service"] == "web"


class TestUpdateComposeFile:
    def test_updates_image_preserving_format(self, tmp_path):
        compose = tmp_path / "compose.yaml"
        compose.write_text(
            "services:\n"
            "  web:\n"
            "    image: nginx:1.24\n"
            "    # keep this comment\n"
            "    ports:\n"
            "      - '80:80'\n"
        )
        update_compose_file(compose, "web", "nginx:1.25")
        content = compose.read_text()
        assert "nginx:1.25" in content
        assert "# keep this comment" in content
        assert "ports:" in content
