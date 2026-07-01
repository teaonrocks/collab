# Dogfood Allowlist Management

Dogfood access is managed server-side in Convex. The renderer never receives deployment credentials,
allowlist contents, WorkOS secrets, Convex deploy keys, or raw auth claims.

## Operator Access

`AETHER_ALLOWED_EMAILS` remains supported as a bootstrap list, but day-to-day changes should use the
internal Convex allowlist function below from a shell authenticated to the production deployment. Keep `AETHER_ALLOWED_EMAILS`
empty or limited to emergency bootstrap operators so removals are driven by Convex data instead of
manual env edits.

## Add A User

Run the internal mutation from an operator shell. The required `operator` is the human owner/admin
making the change; use a stable, recognizable name. Convex deployment authentication authorizes the
command, so no shared secret appears in the command arguments or mutation payload.

```sh
pnpm convex run --prod chat:administerDogfoodAllowlist '{
  "operator": "Archer Chua",
  "email": "friend@example.com",
  "action": "add",
  "reason": "initial dogfood invite"
}'
```

The email is normalized before storage. The user can then sign in with AuthKit and join the shared
dogfood workspace.

## Remove A User

```sh
pnpm convex run --prod chat:administerDogfoodAllowlist '{
  "operator": "Archer Chua",
  "email": "friend@example.com",
  "action": "remove",
  "reason": "left dogfood group"
}'
```

Removal marks the Convex allowlist entry inactive. Existing signed-in sessions continue to authenticate
with WorkOS, but Convex chat queries and mutations reject the user with the standard dogfood blocked
state.

## Audit Trail

Each add or remove writes a `dogfoodAllowlistAudit` row with:

- normalized email
- action
- attributable operator identity
- optional reason
- timestamp

Use the Convex dashboard or a local inspection query when reviewing dogfood access changes. Audit rows
intentionally do not store deployment credentials or renderer-visible secrets. Rejected calls emit a
support-safe Convex failure event with the operation, action, reason length, and timestamp supplied by
the platform; credentials and raw error details are never logged.
