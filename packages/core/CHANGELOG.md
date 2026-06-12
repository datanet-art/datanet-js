# @datanet/core

## 0.1.0

### Minor Changes

- 21b6789: Add metadata-bearing binary transport APIs for DMX and Art-Net workflows, including `publishBinary`, `subscribeBinary`, `subscribeAny`, `publishDmx`, `publishArtNet`, auto-detected typed-array publishes, and helper builders for DMX frames and ArtDMX packets.
- a709c05: Surface plan-limit details on errors: `DataNetError.limit` now carries the
  plan cap that was hit for `device_limit_reached` and `topic_limit_reached`.
  Documented all gateway error codes (fields + retryability) in PROTOCOL.md.
