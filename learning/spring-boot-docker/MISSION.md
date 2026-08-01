# Mission: Navigating a Spring Boot + Docker Java Application

## Why
You're onboarding onto a new team that owns an existing Spring Boot application running in Docker. You need to get productive quickly — reading and reasoning about code you didn't write, not building new services from scratch.

## Success looks like
- Given the repo, run the app locally via Docker/Docker Compose and know what's running where
- Given an endpoint or feature name, trace the path through the code: controller → service → repository (and back)
- Given `application.yml`/`application.properties`, `pom.xml`/`build.gradle`, and the package layout, know what each part does and where to look for a given concern
- Given a failure (exception, bad behavior, stuck container), locate the relevant logs, narrow down the cause, and know how to attach a debugger
- Ability to independently read a slice of the codebase and explain how a feature is implemented, well enough to answer teammates' questions about it

## Constraints
- Starting near-zero on Java, Spring Boot, and Docker — all three at once
- A few weeks of runway, no hard deadline, but wants to reach useful onboarding competence steadily
- Learning is code-reading and system-navigation focused, not "build a Spring Boot app from a tutorial" focused — exercises should use realistic app shapes, not toy CRUD-from-scratch projects
- Sessions should stay short given the working-memory constraints on a beginner absorbing three new things at once

## Out of scope
- Writing new Spring Boot features/services from scratch (may become in-scope later, but not the current goal)
- Deep dives into Spring modules the app doesn't actually use (Security, Cloud, Reactive/WebFlux, Batch) unless they show up in the real codebase
- Kubernetes / container orchestration beyond single-host Docker & Docker Compose
- Deep Java language study disconnected from what's needed to read the app (e.g. generics theory, JVM internals) — pick up just enough Java to read and reason about Spring code
