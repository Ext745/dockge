from __future__ import annotations

from pathlib import Path

import click
from rich.console import Console
from rich.table import Table

from .scanner import ImageMismatch, scan, update_compose_file

console = Console()


@click.group()
@click.option(
    "--stacks-dir",
    envvar="STACKS_DIR",
    type=click.Path(exists=True, file_okay=False, path_type=Path),
    required=True,
    help="Path to the stacks folder containing compose subdirectories.",
)
@click.option(
    "--compose-filename",
    envvar="COMPOSE_FILENAME",
    default="compose.yaml",
    show_default=True,
    help="Name of the compose file in each stack folder.",
)
@click.option(
    "--docker-url",
    envvar="DOCKER_HOST",
    default=None,
    help="Docker daemon URL (default: local socket).",
)
@click.pass_context
def main(ctx, stacks_dir: Path, compose_filename: str, docker_url: str | None):
    """Sync Docker Compose image tags with running container versions."""
    ctx.ensure_object(dict)
    ctx.obj["stacks_dir"] = stacks_dir
    ctx.obj["compose_filename"] = compose_filename
    ctx.obj["docker_url"] = docker_url


@main.command()
@click.pass_context
def report(ctx):
    """Show differences between compose files and running containers."""
    result = scan(
        ctx.obj["stacks_dir"],
        ctx.obj["compose_filename"],
        ctx.obj["docker_url"],
    )

    if result.mismatches:
        table = Table(title="Version Mismatches")
        table.add_column("Stack", style="cyan")
        table.add_column("Service", style="magenta")
        table.add_column("Compose Image", style="red")
        table.add_column("Running Image", style="green")

        for m in result.mismatches:
            table.add_row(m.stack, m.service, m.compose_image, m.running_image)

        console.print(table)
    else:
        console.print("[green]All compose files match running containers.[/green]")

    if result.matched:
        table = Table(title="Matched Services")
        table.add_column("Stack", style="cyan")
        table.add_column("Service", style="magenta")
        table.add_column("Image", style="green")

        for m in result.matched:
            table.add_row(m["stack"], m["service"], m["image"])

        console.print(table)

    if result.unmatched_services:
        table = Table(title="Compose Services Not Running")
        table.add_column("Stack", style="cyan")
        table.add_column("Service", style="magenta")
        table.add_column("Image", style="yellow")

        for s in result.unmatched_services:
            table.add_row(s["stack"], s["service"], s["compose_image"])

        console.print(table)

    if result.unmatched_containers:
        console.print("\n[yellow]Running containers with no matching compose file:[/yellow]")
        for name in result.unmatched_containers:
            console.print(f"  {name}")

    raise SystemExit(1 if result.mismatches else 0)


@main.command()
@click.option("--dry-run", is_flag=True, help="Show what would change without writing files.")
@click.option(
    "--stack",
    multiple=True,
    help="Only update specific stack(s). Can be repeated.",
)
@click.option(
    "--service",
    multiple=True,
    help="Only update specific service(s). Can be repeated.",
)
@click.pass_context
def update(ctx, dry_run: bool, stack: tuple[str, ...], service: tuple[str, ...]):
    """Update compose files to match running container versions."""
    result = scan(
        ctx.obj["stacks_dir"],
        ctx.obj["compose_filename"],
        ctx.obj["docker_url"],
    )

    if not result.mismatches:
        console.print("[green]Nothing to update — all compose files match.[/green]")
        return

    targets = filter_mismatches(result.mismatches, stack, service)
    if not targets:
        console.print("[yellow]No mismatches match the given filters.[/yellow]")
        return

    for m in targets:
        if dry_run:
            console.print(
                f"[yellow]Would update[/yellow] {m.stack}/{m.service}: "
                f"[red]{m.compose_image}[/red] -> [green]{m.running_image}[/green]"
            )
        else:
            update_compose_file(m.compose_file, m.service, m.running_image)
            console.print(
                f"[green]Updated[/green] {m.stack}/{m.service}: "
                f"[red]{m.compose_image}[/red] -> [green]{m.running_image}[/green]"
            )

    if dry_run:
        console.print(f"\n[yellow]Dry run — {len(targets)} file(s) would be updated.[/yellow]")
    else:
        console.print(f"\n[green]{len(targets)} service(s) updated.[/green]")


def filter_mismatches(
    mismatches: list[ImageMismatch],
    stacks: tuple[str, ...],
    services: tuple[str, ...],
) -> list[ImageMismatch]:
    filtered = mismatches
    if stacks:
        filtered = [m for m in filtered if m.stack in stacks]
    if services:
        filtered = [m for m in filtered if m.service in services]
    return filtered
