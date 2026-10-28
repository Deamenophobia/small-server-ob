# Docker container observations

Edit an SSH server, enable **Monitor Docker containers**, and save. Expand **Containers** on its card to see names, images, lifecycle states, Docker's uptime/exit-status text, and health-check status. The option is saved locally and included in registry exports. Existing servers remain opted out until you enable it.

## Requirements

- Linux with Python 3 and the Docker CLI on the remote server; existing verified SSH access.
- A Docker Engine listening on `unix:///var/run/docker.sock`, accessible by the SSH user without an interactive prompt. The collector pins this local socket so a Docker context or `DOCKER_HOST` cannot redirect it to another server.
- Rootless Docker, custom socket paths, Podman, and Kubernetes are outside this first version. The local computer only needs the app's existing Node.js and OpenSSH setup.

Docker socket access on a conventional installation grants substantial, potentially root-level privileges. This app only issues a fixed observational command, but that does not restrict the underlying SSH account's Docker authority. Configure access deliberately yourself; the app never invokes sudo, adds group memberships, changes permissions, or exposes a Docker TCP port. See [Docker's permission guidance](https://docs.docker.com/engine/install/linux-postinstall/).

## What the panel means

- **Running** describes container lifecycle, not application health. **Healthy**, **unhealthy**, and **starting** come from Docker's configured health check. A running container without a health status shows **No health check configured**. Health is not evaluated for stopped or paused containers.
- Stopped containers are listed, including successful one-off jobs. Stopped does not automatically mean broken.
- Server health badges and the **Needs attention** server filter continue to describe host checks. Container health is separate and unhealthy counts are highlighted in the panel.
- Missing Docker, permission errors, daemon errors, malformed output, and timeouts are displayed explicitly. Valid host metrics remain available if optional Docker collection fails. A complete SSH failure still makes the host observation unknown.
- Paused or stale server cards label container data as the last observation. Collection runs only while the local app runs. There is no always-on agent or cloud billing API involved.

The fixed command is `docker --host unix:///var/run/docker.sock ps --all --no-trunc --last 101 --format <fixed-field-template>`. The template selects only ID, name, image, state, and status. It does not retrieve command lines, environment variables, labels, logs, or full inspect payloads. Docker gets a two-second subprocess deadline within the existing server timeout. Up to 100 of the most recently created containers are displayed; an additional entry detects truncation, and counts then explicitly describe the displayed subset. Increase the server timeout if SSH login consumes most of it.

Only the latest container snapshot is cached in the private local registry (and its normal backup); historical host samples omit container inventory. The UI preserves expanded panels and their list scroll positions during polling. Per-container CPU/memory statistics, controls, and log viewing are deferred.

## Implementation and references

`lib/checks/docker.mjs` owns the fixed Python query and strict output parser. The SSH collector flushes host metrics first and emits Docker data on a second line. `public/js/features/fleet/containers.js` renders the escaped inventory independently of host metric markup.

Reviewed [Beszel's Docker collector](https://github.com/henrygd/beszel/blob/main/agent/docker.go) for separation of state and health, bounded collection, and selective data handling; reviewed [Portainer's health panel](https://github.com/portainer/portainer/blob/develop/app/react/docker/containers/ItemView/HealthStatus.tsx) for explicit absent-health presentation. This implementation was written for Small Server OB; no source was copied. Docker's [container listing reference](https://docs.docker.com/reference/cli/docker/container/ls/) defines the CLI fields.

Automated checks cover opt-in compatibility, health parsing, malformed output, escaping, timeout isolation, persistence/import/export, and a Python collector exercised with a mocked Docker command. `npm run demo` supplies only invented containers. Live Docker permissions and connectivity require a separately configured host and are not verified by these tests.
