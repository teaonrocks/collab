# Dogfood Allowlist Management

Dogfood access is managed server-side in Convex. The renderer never receives the operator key,
allowlist contents, WorkOS secrets, Convex deploy keys, or raw auth claims.

## Operator Setup

Set a shared operator key in the Convex deployment:

```sh
pnpm convex env set AETHER_ALLOWLIST_OPERATOR_KEY "<shared-operator-key>"
```

`AETHER_ALLOWED_EMAILS` remains supported as a bootstrap list, but day-to-day changes should use the
Convex allowlist functions below. Once the operator key is configured, keep `AETHER_ALLOWED_EMAILS`
empty or limited to emergency bootstrap operators so removals are driven by Convex data instead of
manual env edits.

## Add A User

Run the mutation from an operator shell. Keep the key out of docs, screenshots, Linear comments, and
terminal transcripts shared with dogfood users.

```sh
pnpm convex run chat:updateDogfoodAllowlist '{
  "operatorKey": "<shared-operator-key>",
  "email": "friend@example.com",
  "action": "add",
  "reason": "initial dogfood invite"
}'
```

The email is normalized before storage. The user can then sign in with AuthKit and join the shared
dogfood workspace.

## Remove A User

```sh
pnpm convex run chat:updateDogfoodAllowlist '{
  "operatorKey": "<shared-operator-key>",
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
- operator label
- optional reason
- timestamp

Use the Convex dashboard or a local inspection query when reviewing dogfood access changes. Audit rows
intentionally do not store the operator key or renderer-visible secrets.
