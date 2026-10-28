# Run Small Server OB on Linux

Small Server OB runs on your Linux computer and opens in your browser. The same application supports Windows and Linux, including SSH metrics, HTTP/TCP checks, notes, links, saved configuration, and optional billing access.

## Requirements

- Node.js 22 or newer and npm. Node.js 24 LTS is a good starting point; choose your distribution and architecture in the [official Node.js installation instructions](https://nodejs.org/en/download).
- A modern web browser.
- An OpenSSH **client** on this computer for SSH checks. On Ubuntu/Debian, install it with `sudo apt install openssh-client` if `ssh -V` is unavailable. See [Ubuntu's OpenSSH documentation](https://ubuntu.com/server/docs/how-to/security/openssh-server/).
- Python 3 on each monitored Linux server when collecting SSH metrics.

The launcher checks the Node.js version. A distribution's default Node.js package may be too old, so check `node --version` before continuing. Run Small Server OB as your ordinary user so it uses that user's SSH configuration and agent.

## Start

From your cloned or extracted Small Server OB folder:

```sh
npm ci
./start.sh
```

Open **http://127.0.0.1:4310** in your browser. Keep the terminal open; press **Ctrl+C** to stop. The launcher runs in the foreground and binds the app only to localhost. No system service or cloud deployment is required.

If a ZIP download did not preserve the executable permission, run `sh start.sh`, or use `chmod +x start.sh` once. `npm start` also works. When you launch the script by its full path from another directory, it still finds the application and its configuration beside the script.

To use another port:

```sh
PORT=4320 ./start.sh
```

Use the URL printed in the terminal. The port can also be saved in `lookout.config.json`; see [Configuration](configuration.md).

## Saved data

The default registry and billing cache stay in the project's ignored `data/` directory and survive restarts. Keep this directory when upgrading or replacing the source folder. Alternatively, use a stable directory in your home folder:

```sh
LOOKOUT_DATA_DIR="$HOME/.local/share/lookout" ./start.sh
```

Use the same location on subsequent launches. To save this choice, set `LOOKOUT_DATA_DIR` to your **absolute path** in the project's `.env`. Shell expressions such as `$HOME` and `~` are not expanded inside `.env`. Never commit `.env`, the registry, or private keys.

To move configurations from Windows, use **Workspace settings → Export registry** there, then **Import registry** on Linux. Imports append records. Configure SSH aliases separately in your Linux user's `~/.ssh/config`; exports do not include SSH keys or billing credentials. See the [SSH setup in the README](../README.md#ssh-setup). Establish and verify the connection in your Linux terminal before adding an SSH check.

## Optional billing

The same [billing setup](costs-and-billing.md) applies on Linux. AWS profiles belong to your Linux user's AWS configuration. For a DigitalOcean token file, use a Linux absolute path in `.env`, for example:

```dotenv
LOOKOUT_DO_TOKEN_FILE=/home/YOUR_NAME/.config/lookout/do-token.txt
```

Restrict the token file to your user with `chmod 600 /path/to/do-token.txt`. Health checks and saved cost estimates do not call billing APIs; billing refresh remains explicit and opt-in.

## Verification and limits

The CI pipelines run on Linux with Node.js 22 and 24. Alongside the shared suite, the Linux launcher tests start the actual application from a directory containing spaces, use a separate registry, verify the local web interface, save and restore a fictional server, and exercise SIGTERM and Ctrl+C (SIGINT) shutdown. They also check missing and outdated Node.js errors.

The tests use temporary data and a paused fictional server. They do not contact your servers or provider billing APIs. Automated coverage is for Linux x86-64; other architectures and desktop distributions have not been individually verified. This is a Node.js application with a shell launcher, not a standalone `.deb` or AppImage.
