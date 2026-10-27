# @aptoma/biome-rules

[Biome](https://biomejs.dev) JS lint plugins that keep TypeScript types honest. Ported from [anti-slop](https://github.com/dmmulroy/anti-slop).

Requires `@biomejs/biome` 2.6.3 or newer.

## Rules

| Rule                      | Flags                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `noChainedTypeAssertions` | Nested type assertions such as `value as unknown as Foo`                                             |
| `noWidenThenAssert`       | Local bindings that erase a known type and are later asserted back to a narrower one                 |
| `noObjectParameters`      | Function parameters typed as the broad `object` type                                                 |
| `noUnknownReturns`        | Functions that return `unknown` instead of a parsed type                                             |
| `noKnownValueWidening`    | Explicit annotations that widen a known value, such as an anonymous object type on an object literal |

## Usage

    $ npm install -D @aptoma/biome-rules

Enable all rules by extending the preset in `biome.json`:

```json
{
	"extends": ["@aptoma/biome-rules/recommended"]
}
```

The preset skips `noChainedTypeAssertions` in test files.

To pick rules yourself, list them as plugins instead. Paths resolve from the project root:

```json
{
	"plugins": ["./node_modules/@aptoma/biome-rules/rules/no-object-parameters.ts"]
}
```

Diagnostics are reported under the `plugin` category. Suppress one with the rule name:

```ts
// biome-ignore lint/plugin/noObjectParameters: reason
```

## Test & Development

Running tests

    $ npm test

Creating releases

    $ npm run release
    $ npm run release:minor
    $ npm run release:major
