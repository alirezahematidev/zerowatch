# Examples

These files import from `"watchx"` as an installed package would. To run them against a local checkout, either build the package (`npm run build`) and adjust the import to `"../dist/index.js"`, or link the package.

On Node.js ≥ 22.18 (TypeScript stripping is on by default) you can run the `.ts` files directly:

```sh
node examples/basic-iterator.ts ./src
```

| File | Shows |
| --- | --- |
| [`basic-iterator.ts`](basic-iterator.ts) | The async-iterator API (`for await`). |
| [`typed-events.ts`](typed-events.ts) | Typed `on(...)` listeners + move detection. |
| [`batching-and-ignore.ts`](batching-and-ignore.ts) | `batch`, `debounce`, `gitignore`, `ignore`, `extensions`. |
