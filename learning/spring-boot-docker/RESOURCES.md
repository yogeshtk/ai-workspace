# Spring Boot + Docker Navigation Resources

## Knowledge

- [Spring Boot Reference Documentation](https://docs.spring.io/spring-boot/docs/3.2.5/reference/htmlsingle/)
  The canonical reference for how Spring Boot actually works — auto-configuration, `@SpringBootApplication`, externalized config, profiles. Use for: authoritative answers on "what does this annotation/property actually do."
- [Getting Started: Building an Application with Spring Boot](https://spring.io/guides/gs/spring-boot/) (spring.io official guide)
  Short, official, hands-on walkthrough of a minimal Spring Boot app. Use for: the first "what are all these files" orientation lesson.
- [Spring Boot Documentation Overview](https://docs.spring.io/spring-boot/documentation.html)
  Index into the full official doc set (how-to guides, reference, API). Use for: finding the right official doc page for a specific feature as it comes up in the real codebase.
- [Docker Docs](https://docs.docker.com/) (official)
  Canonical source on images vs. containers, Dockerfiles, `docker compose`, volumes, networking, logs. Use for: anything Docker-mechanics — what a command actually does, not just "the command that works."
- Spring Boot layered architecture (Controller → Service → Repository) — cross-referenced across multiple community write-ups (Ramesh Fadatare / Medium, dev.to "Spring Boot Project Structure: Best Practices"). No single canonical source for this pattern; treat as consensus community convention, not official spec. Use for: the "trace a request through the code" lessons — where to expect each responsibility to live.
- [JetBrains Blog: Spring Boot Debugging — Now Remote](https://blog.jetbrains.com/idea/2026/01/spring-boot-debugging-now-remote/)
  Official JetBrains guidance on attaching a remote debugger to a Spring Boot process, including containerized ones. Use for: the "debug a failure in a running container" lessons (JDWP, port 5005, IDE remote-debug config).

## Wisdom (Communities)

- [r/SpringBoot](https://reddit.com/r/SpringBoot) and [r/java](https://reddit.com/r/java)
  Use for: sanity-checking whether an observed pattern in the team's codebase is idiomatic or a local quirk, and general troubleshooting.
- [Stack Overflow — `spring-boot` tag](https://stackoverflow.com/questions/tagged/spring-boot) and [`docker` tag](https://stackoverflow.com/questions/tagged/docker)
  Use for: specific error messages and stack traces — search the exact exception text here before guessing.

## Gaps

- No resource yet specific to *this* team's actual codebase (its module layout, its Docker Compose setup, its conventions). Once the user has repo access, the highest-value "resource" will be the codebase itself plus any internal onboarding docs / README — add those here once available.
- No community identified yet specifically for Docker (vs. Spring/Java). r/docker exists but hasn't been vetted for signal quality — revisit if Docker-specific troubleshooting comes up often.
