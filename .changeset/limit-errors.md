---
"@datanet/core": minor
---

Surface plan-limit details on errors: `DataNetError.limit` now carries the
plan cap that was hit for `device_limit_reached` and `topic_limit_reached`.
Documented all gateway error codes (fields + retryability) in PROTOCOL.md.
