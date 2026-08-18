# Shared Harness Protocol

Language-neutral, versioned contracts shared by the three independently deployed Harnesses.

Current production slice:

- `source-knowledge-artifact.v1`: chain 2 output reused by chain 3.
- Wire fields use `snake_case`, UTC RFC3339 timestamps, and integer milliseconds.
- Unknown optional v1 fields are ignored; unknown major versions are rejected.
- Artifacts bind to the exact `video-environment.v1` file SHA-256.

The protocol contains no model provider, credentials, prompts, or runtime service. Python and Node remain independent failure and rollback boundaries.
