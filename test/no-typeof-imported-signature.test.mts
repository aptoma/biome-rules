import {testRule} from './rule-tester.mts';

testRule('no-typeof-imported-signature.ts', {
	valid: [
		{
			name: 'ReturnType of an import',
			code: "import {getUser} from './users.ts';\ntype User = ReturnType<typeof getUser>;"
		},
		{
			name: 'local function',
			code: 'function createUser(name: string) {\n\treturn {name};\n}\ntype Input = Parameters<typeof createUser>;'
		},
		{name: 'local class', code: 'class Store {}\ntype S = InstanceType<typeof Store>;'},
		{
			name: 'shadowed import',
			code: "import {createUser} from './users.ts';\nfunction f() {\n\tconst createUser = (name: string) => name;\n\ttype Input = Parameters<typeof createUser>;\n\treturn createUser;\n}"
		},
		{
			name: 'locally declared utility with the same name',
			code: "import {createUser} from './users.ts';\ntype Parameters<T> = T;\ntype Input = Parameters<typeof createUser>;"
		},
		{
			name: 'named type argument',
			code: "import type {UserInput} from './users.ts';\ntype Input = Parameters<UserInput>;"
		},
		{name: 'global value', code: 'type Args = ConstructorParameters<typeof Map>;'}
	],
	invalid: [
		{code: "import {createUser} from './users.ts';\ntype Input = Parameters<typeof createUser>[0];", errors: 1},
		{code: "import {Store} from './store.ts';\ntype S = InstanceType<typeof Store>;", errors: 1},
		{code: "import {Store} from './store.ts';\ntype Args = ConstructorParameters<typeof Store>;", errors: 1},
		{name: 'default import', code: "import Store from './store.ts';\ntype S = InstanceType<typeof Store>;", errors: 1},
		{
			name: 'aliased import',
			code: "import {createUser as make} from './users.ts';\nfunction f(input: Parameters<typeof make>[0]) {\n\treturn input;\n}",
			errors: 1
		},
		{
			name: 'namespace import',
			code: "import * as users from './users.ts';\ntype Input = Parameters<typeof users.api.createUser>;",
			errors: 1
		},
		{
			name: 'parenthesized',
			code: "import {createUser} from './users.ts';\ntype Input = Parameters<(typeof createUser)>;",
			errors: 1
		},
		{
			name: 'through a local alias',
			code: "import {createUser} from './users.ts';\ntype Create = typeof createUser;\ntype Input = Parameters<Create>;",
			errors: 1
		}
	]
});
