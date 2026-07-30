# Contributing to MermaidFlow

Thanks for wanting to contribute! MermaidFlow follows a small set of
conventions to keep the codebase pleasant to work in.

## Commit messages

Conventional Commits:

```
feat: add ELK layout preset
fix: correct edge routing for self-loops
refactor: split renderEngine into worker-friendly modules
test: cover svgManipulator edge cases
docs: expand file-format.md with examples
```

Commit bodies should answer: **what changed, why, and how to test it.**

## Code style

- Prettier + ESLint are enforced. Run `npm run format && npm run lint` before pushing.
- TypeScript is `strict`. Avoid `any` outside `src/**/*` FFI boundaries.
- No file over 1000 LOC. Split at the ~300-500 LOC mark.
- Each feature exposes only its `index.ts` — internal modules are private.
- Business logic goes in `services/`, not in components.

## Testing

- Every service module should have a colocated `*.test.ts`.
- Components: render + interaction tests with Testing Library.
- Run `npm run test` — CI blocks on any regression.

## Pull requests

- One card per PR (see the roadmap in the original prompt).
- Include a short before/after screenshot for anything user-visible.
- Update `README.md` / docs when adding a public feature.
