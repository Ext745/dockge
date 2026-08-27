from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import docker
from ruamel.yaml import YAML


@dataclass
class ImageMismatch:
    stack: str
    service: str
    compose_image: str
    running_image: str
    compose_file: Path


@dataclass
class ScanResult:
    mismatches: list[ImageMismatch] = field(default_factory=list)
    matched: list[dict] = field(default_factory=list)
    unmatched_containers: list[str] = field(default_factory=list)
    unmatched_services: list[dict] = field(default_factory=list)


def parse_image_ref(image: str) -> tuple[str, str]:
    """Split an image reference into (repository, tag). Defaults tag to 'latest'."""
    if "@" in image:
        repo, digest = image.split("@", 1)
        return repo, digest

    parts = image.rsplit(":", 1)
    if len(parts) == 2 and "/" not in parts[1]:
        return parts[0], parts[1]
    return image, "latest"


def normalize_image_name(name: str) -> str:
    """Normalize docker.io short names so comparisons work."""
    name = re.sub(r"^docker\.io/", "", name)
    name = re.sub(r"^library/", "", name)
    return name


def get_running_containers(client: docker.DockerClient) -> dict[str, dict]:
    """Return a map of container info keyed by (project, service)."""
    containers = {}
    for c in client.containers.list():
        labels = c.labels or {}
        project = labels.get("com.docker.compose.project", "")
        service = labels.get("com.docker.compose.service", "")
        if not project or not service:
            continue

        image_tags = c.image.tags if c.image.tags else []
        image_id = c.image.id

        config_image = c.attrs.get("Config", {}).get("Image", "")
        repo_digests = c.image.attrs.get("RepoDigests", [])

        containers[(project, service)] = {
            "config_image": config_image,
            "image_tags": image_tags,
            "image_id": image_id,
            "repo_digests": repo_digests,
            "container_name": c.name,
            "status": c.status,
        }
    return containers


def discover_compose_files(
    stacks_dir: Path, compose_filename: str = "compose.yaml"
) -> dict[str, Path]:
    """Find all compose files in the stacks directory. Returns {stack_name: path}."""
    stacks = {}
    if not stacks_dir.is_dir():
        return stacks

    for entry in sorted(stacks_dir.iterdir()):
        if not entry.is_dir():
            continue
        compose_path = entry / compose_filename
        if not compose_path.exists():
            for alt in ["compose.yml", "docker-compose.yaml", "docker-compose.yml"]:
                alt_path = entry / alt
                if alt_path.exists():
                    compose_path = alt_path
                    break
        if compose_path.exists():
            stacks[entry.name] = compose_path
    return stacks


def parse_compose_services(compose_path: Path) -> dict[str, str]:
    """Parse a compose file and return {service_name: image}."""
    yaml = YAML()
    yaml.preserve_quotes = True
    data = yaml.load(compose_path)
    if not data:
        return {}

    services = data.get("services", {})
    if not services:
        return {}

    result = {}
    for svc_name, svc_config in services.items():
        if isinstance(svc_config, dict) and "image" in svc_config:
            result[svc_name] = svc_config["image"]
    return result


def find_best_running_tag(
    compose_repo: str, container_info: dict
) -> str | None:
    """Find the best matching tag from the running container's image."""
    norm_compose = normalize_image_name(compose_repo)

    for tag in container_info.get("image_tags", []):
        tag_repo, tag_version = parse_image_ref(tag)
        if normalize_image_name(tag_repo) == norm_compose:
            return tag

    if container_info["image_tags"]:
        return container_info["image_tags"][0]

    return container_info.get("config_image")


def scan(
    stacks_dir: Path,
    compose_filename: str = "compose.yaml",
    docker_url: str | None = None,
) -> ScanResult:
    """Compare running container images against compose file definitions."""
    client = docker.DockerClient(base_url=docker_url) if docker_url else docker.from_env()
    running = get_running_containers(client)
    compose_files = discover_compose_files(stacks_dir, compose_filename)

    result = ScanResult()
    seen_keys: set[tuple[str, str]] = set()

    for stack_name, compose_path in compose_files.items():
        services = parse_compose_services(compose_path)

        for svc_name, compose_image in services.items():
            key = (stack_name, svc_name)
            seen_keys.add(key)
            container = running.get(key)

            if not container:
                result.unmatched_services.append({
                    "stack": stack_name,
                    "service": svc_name,
                    "compose_image": compose_image,
                    "compose_file": compose_path,
                })
                continue

            compose_repo, compose_tag = parse_image_ref(compose_image)
            running_image = find_best_running_tag(compose_repo, container)

            if not running_image:
                continue

            running_repo, running_tag = parse_image_ref(running_image)

            compose_norm = normalize_image_name(compose_repo)
            running_norm = normalize_image_name(running_repo)

            if compose_norm == running_norm and compose_tag == running_tag:
                result.matched.append({
                    "stack": stack_name,
                    "service": svc_name,
                    "image": compose_image,
                })
            else:
                result.mismatches.append(ImageMismatch(
                    stack=stack_name,
                    service=svc_name,
                    compose_image=compose_image,
                    running_image=running_image,
                    compose_file=compose_path,
                ))

    for key, container in running.items():
        if key not in seen_keys:
            result.unmatched_containers.append(
                f"{key[0]}/{key[1]} ({container['container_name']})"
            )

    client.close()
    return result


def update_compose_file(compose_path: Path, service: str, new_image: str) -> None:
    """Update a single service's image tag in a compose file, preserving formatting."""
    yaml = YAML()
    yaml.preserve_quotes = True

    data = yaml.load(compose_path)
    services = data.get("services", {})
    if service in services and "image" in services[service]:
        services[service]["image"] = new_image
        yaml.dump(data, compose_path)
