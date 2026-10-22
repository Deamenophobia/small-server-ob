# Costs and billing

Lookout separates **monthly server estimates** from **provider-reported account usage**. Neither is a guaranteed invoice amount due. Prices, discounts, credits, taxes, bandwidth, backups, extra storage, public IP addresses, and other services can change what you pay.

**Checking server health does not call Cost Explorer.** Opening or refreshing the dashboard and viewing saved estimates also make no billing requests. AWS billing is disabled by default. If you enable it, only **Refresh billing** can request new account usage; successful results are reused for six hours. One fresh AWS request per day would cost USD 0.30 over 30 days at the current primary-view API price. This is separate from the cost of running your servers.

## Estimates

Click the cost on a card to set an hourly or monthly rate, currency, basis, and optional source link. Hourly estimates assume the server runs for every hour in the current UTC calendar month: October 2026 has 744 hours. Monthly rates remain fixed. Estimates do not infer accrued charges or server start/stop times from monitoring history. Pausing a health check does not stop cloud billing.

The total indicates how many servers have prices. Unknown prices stay unknown and are excluded. An explicit zero is allowed for a known free plan. Different currencies are not converted or combined. Estimates are saved in the local registry and included in registry export/import.

Initial prices can be based on public list prices, but the basis must state any assumptions. Guest CPU, memory, and filesystem size are not enough to identify a DigitalOcean plan. Even an EC2 On-Demand lifecycle does not reveal all billing discounts or ancillary charges. Enter a bundled monthly budget if you want to account for known extras, and record those inclusions in the basis.

## Connect DigitalOcean

1. Open [API tokens](https://cloud.digitalocean.com/account/api/tokens) for the correct DigitalOcean team and create a token with only `billing:read`.
2. Save it in a private UTF-8 text file outside the repository. Restrict that file to your OS user. Do not put the token in server notes, URLs, screenshots, or chat.
3. Copy `.env.example` to `.env` in this project. Set the file path, for example:

```dotenv
LOOKOUT_DO_TOKEN_FILE=C:/Users/YOUR_NAME/.config/lookout/do-token.txt
```

Alternatively, provide `DIGITALOCEAN_TOKEN` in the environment of the Lookout process. The token is read only on the backend. It is not returned to the browser or included in exports or cached billing responses.

The adapter calls `GET https://api.digitalocean.com/v2/customers/my/balance`. It shows month-to-date usage and the provider's month-to-date balance, which includes prior account balance. Negative balances represent credit. The provider's generation time is shown separately from retrieval time. See the [official billing API](https://docs.digitalocean.com/platform/billing/reference/api/).

## Connect AWS

1. Enable Cost Explorer in the correct AWS account's [billing console](https://console.aws.amazon.com/costmanagement/home#/cost-explorer). Newly enabled data may take time to become available.
2. Use an identity allowed to call `ce:GetCostAndUsage`. For a simple read-only policy, the administrator can use:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ce:GetCostAndUsage"],
      "Resource": "*"
    }
  ]
}
```

3. Configure a local profile, preferably with IAM Identity Center. With the AWS CLI installed, use your organization's account/role details:

```powershell
aws configure sso --profile lookout-billing
aws sso login --profile lookout-billing
```

4. Add to Lookout's `.env`:

```dotenv
LOOKOUT_AWS_BILLING=1
LOOKOUT_AWS_PROFILE=lookout-billing
```

The adapter uses the AWS SDK's local profile provider (`fromIni`, including supported SSO/profile mechanisms). If no profile is specified, complete AWS process-environment credentials are used when present; otherwise the default local profile is used. It does not retrieve instance-role credentials from monitored servers. `LOOKOUT_AWS_PROFILE` takes priority over `AWS_PROFILE`. Standard local credentials files are supported, but long-lived root access keys should not be used.

Sources: [AWS credential setup](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html), [Cost Explorer API permissions](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-api.html), [GetCostAndUsage](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_GetCostAndUsage.html).

## Fetching and scope

Restart Lookout after configuring credentials, then choose **Refresh billing**. One AWS profile and one DigitalOcean team are supported per process. Requests are explicit; health checks and opening the dashboard never trigger a billing API query.

Successful responses are cached in ignored `data/billing-cache.json` for six hours and survive restart. Requests within the cache lifetime reuse the saved amounts. A new billing month invalidates the cache. Failed sources keep any prior amount labeled stale/unavailable, and missing or malformed amounts never become zero. Concurrent refreshes share the same work. Failed refreshes are throttled for one minute.

AWS queries a single ungrouped current-month total of `UnblendedCost`, with one attempt and no automatic pagination. An unexpected partial response is treated as unavailable. This is usage cost for the account; a management account can include organization members. It does not allocate costs to the specific server cards or report your invoice balance due.

AWS charges **USD 0.01 per primary-view Cost Explorer API request**, according to its [pricing page](https://aws.amazon.com/aws-cost-management/aws-cost-explorer/pricing/), checked 2026-10-22. Lookout does not enable granular resource-level billing features or change any cloud settings. Taxes and service pricing remain governed by the providers.

DigitalOcean totals also cover the entire account, including resources outside Lookout. Never add account usage to the fleet estimate: these amounts overlap and cover different periods and scopes.

## Verification

`npm test` checks calendar-month estimates, partial coverage, mixed currencies, explicit zero, invalid input, persistence, provider parsing, negative credits, no-query defaults, cache reuse/restart, and error handling with injected provider responses. Live billing access cannot be verified until you supply credentials. Server SSH access does not grant billing access.
