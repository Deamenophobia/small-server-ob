# Configuration

Copy `lookout.config.example.json` to `lookout.config.json`, change the values you need, and restart Lookout. Every field is optional; omitted values use defaults. Unknown keys, invalid types, and out-of-range values stop startup with an error before health collection begins.

```powershell
Copy-Item lookout.config.example.json lookout.config.json
npm start
```

On Linux, use `cp lookout.config.example.json lookout.config.json`, then `./start.sh`.

`lookout.config.json` is ignored by Git. It contains operational settings, not secrets. Continue using local AWS profiles or the DigitalOcean token-file setup described in [Costs and billing](costs-and-billing.md).

| Setting                      | Default         | Allowed values / meaning                                                    |
| ---------------------------- | --------------- | --------------------------------------------------------------------------- |
| `port`                       | `4310`          | Integer 1–65535; host stays `127.0.0.1`                                     |
| `dataDirectory`              | Project `data/` | Absolute path, or relative to the config file                               |
| `monitoring.intervalSeconds` | `30`            | 10–3600; initial interval for a new registry                                |
| `monitoring.timeoutMs`       | `10000`         | 2000–30000; default for new server records                                  |
| `monitoring.concurrency`     | `4`             | 1–16 simultaneous checks; batches do not overlap                            |
| `monitoring.historyLimit`    | `60`            | 1–1000 observations retained per server                                     |
| `monitoring.maxServers`      | `200`           | 1–2000; also checked when loading/importing a registry                      |
| `thresholds.cpu`             | `90`            | 1–100; warn at or above this percentage                                     |
| `thresholds.memory`          | `85`            | 1–100; warn at or above this percentage                                     |
| `thresholds.disk`            | `85`            | 1–100; warn at or above this root-filesystem percentage                     |
| `thresholds.latencyMs`       | `1500`          | 1–60000; HTTP/TCP slow-response threshold                                   |
| `thresholds.staleMultiplier` | `2.5`           | 1–20; stale after this many polling intervals                               |
| `thresholds.staleMinimumMs`  | `45000`         | 1000–3600000; minimum age before stale classification                       |
| `billing.cacheHours`         | `6`             | 1–168; successful billing-result reuse, never an automatic polling interval |
| `billing.retrySeconds`       | `60`            | 60–3600; minimum delay between failed refresh attempts                      |
| `ui.refreshMs`               | `5000`          | 1000–60000; browser fetches local state, not cloud billing                  |
| `ui.historyVisible`          | `28`            | 1–100 and no greater than retained history                                  |

All numeric settings except `staleMultiplier` are integers. The effective thresholds drive the server classification, browser warning bars, and connection-guide text. The UI receives only an explicit configuration allowlist, never credentials.

## Precedence

1. Built-in defaults.
2. JSON configuration file.
3. `PORT` and `LOOKOUT_DATA_DIR` environment overrides.

`LOOKOUT_CONFIG` selects an alternative JSON file; a relative path is resolved from the working directory. If explicitly selected, a missing file is an error. With no override, Lookout checks `lookout.config.json` in the project directory. Relative `LOOKOUT_DATA_DIR` paths resolve from the working directory.

The entry point loads the project's optional `.env` before resolving configuration. Existing process environment values take precedence over `.env` values. Billing opt-in variables and token/profile settings stay in that environment path; they are not accepted as JSON config keys.

An **existing registry's saved interval** takes precedence over `monitoring.intervalSeconds`. Change it through Workspace settings. A server's saved timeout similarly takes precedence over the default for new records. This avoids changing established monitoring behavior merely by changing startup defaults.

## Example: quieter polling, stricter disk warning

```json
{
  "monitoring": { "intervalSeconds": 60, "concurrency": 2 },
  "thresholds": { "disk": 80 },
  "billing": { "cacheHours": 24 }
}
```

The billing cache still fetches only after an explicit **Refresh billing** request. Opening the dashboard, checking server health, and displaying estimates never query Cost Explorer.
