# Design Lasagna: Design System Language Server for VS Code changelog

This changelog records VS Code-specific integration changes. Shared language-server behavior is documented in the [server changelog](../../CHANGELOG.md).

## [Unreleased]

- Forward recognition and diagnostic settings only when explicitly configured, so editor defaults do not override project configuration.
- Use server-managed configuration and manifest watching rather than fixed filename-pattern watchers.

## [0.1.4]

Initial preview release.

- Component, attribute, token, utility-class, and slot IntelliSense.
- DTCG and Design Lasagna schema diagnostics.
- Lifecycle-aware diagnostics and migration quick fixes.
- Local manifest configuration and package discovery.
