import {testRule} from './rule-tester.mts';

testRule('no-object-parameters.ts', {
	valid: [
		'type Alias = object;',
		'function f(value: Alias) {}',
		'interface Owner { readonly id: string } function f(value: Owner) {}',
		'function f<Value>(value: Value) {}',
		'function f<Value extends object>(value: Value) {}',
		'function f<Value extends Owner, Owner extends { readonly id: string }>(value: Value) {}',
		'type Owner = { readonly id: string }; function f<Value extends Owner>(value: Value) {}',
		'type Alias = object; function consume<Alias>(value: Alias) {}',
		'type Alias = object; type Consumer<Alias> = (value: Alias) => void;',
		'type Alias = object; interface Consumer<Alias> { consume(value: Alias): void }',
		'type Key = object; type Mapped<Input> = { [Key in keyof Input]: (value: Key) => void };',
		'type Item = object; type Unpacked<Input> = Input extends Promise<infer Item> ? (value: Item) => void : never;',
		'type Payload = object; function outer() { type Payload = { readonly id: string }; function consume(value: Payload) {} }',
		'type Identity<T> = T; function consume<Identity>(value: Identity) {}',
		'function one() { type Payload = object; } function two() { function consume(value: Payload) {} }',
		'type T = string; type External = T; type UsesExternal<T> = External; function consume(value: UsesExternal<object>) {}'
	],
	invalid: [
		{code: 'function f(value: object) {}', errors: 1},
		{code: 'type Identity<T> = T; function f(value: Identity<Identity<object>>) {}', errors: 1},
		{code: 'type Alias = object; function f(value: Alias) {}', errors: 1},
		{code: 'type Alias = (object); function f(value: Alias) {}', errors: 1},
		{
			code: 'type Item = object; type Fallback<Input> = Input extends infer Item ? string : (value: Item) => void;',
			errors: 1
		},
		{code: 'function consume(value: object = {}): void {}', errors: 1},
		{code: 'function consume({ value }: object = {}): void {}', errors: 1},
		{code: 'type Bag = object; function consume({ value }: Bag): void {}', errors: 1},
		{code: 'function outer() { type Payload = object; function consume(value: Payload) {} }', errors: 1},
		{code: 'function outer() { function consume(value: Payload) {} type Payload = object; }', errors: 1},
		{code: 'type Identity<T> = T; function consume(value: Identity<object>) {}', errors: 1},
		{
			code: 'type Identity<T> = T; type Wrapped<T> = Identity<T>; function consume(value: Wrapped<object>) {}',
			errors: 1
		}
	]
});
