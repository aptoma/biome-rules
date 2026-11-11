import {testRule} from './rule-tester.mts';

testRule('no-exported-derived-alias.ts', {
	valid: [
		{
			name: 'owner exports a type derived from its own value',
			code: 'function createService() {\n\treturn {run() {}};\n}\nexport type Service = ReturnType<typeof createService>;'
		},
		{
			name: 'not exported',
			code: "import * as pre from './pre.ts';\ntype User = Awaited<ReturnType<typeof pre.getUser>>;"
		},
		{
			name: 'derived type nested in an exported object type',
			code: "import * as pre from './pre.ts';\nexport type Route = {Pres: {user: Awaited<ReturnType<typeof pre.getUser>>}};"
		},
		{
			name: 'imported signature inside the utility argument',
			code: "import {getUser} from './users.ts';\nexport type Route = Awaited<{load: typeof getUser}>;"
		},
		{
			name: 'other top-level utility',
			code: "import {getUser} from './users.ts';\nexport type User = Partial<ReturnType<typeof getUser>>;"
		},
		{
			name: 'locally declared utility with the same name',
			code: "import {getUser} from './users.ts';\ntype ReturnType<T> = T;\nexport type User = ReturnType<typeof getUser>;"
		},
		{name: 'no typeof', code: "import type {User} from './users.ts';\nexport type Loaded = NonNullable<User>;"},
		{
			name: 'shadowed import',
			code: "import {getUser} from './users.ts';\nexport namespace Users {\n\tconst getUser = () => 1;\n\texport type User = ReturnType<typeof getUser>;\n}"
		}
	],
	invalid: [
		{
			code: "import * as pre from './pre.ts';\nexport type UserModel = Awaited<ReturnType<typeof pre.getUser>>;",
			errors: 1
		},
		{code: "import {getUser} from './users.ts';\nexport type User = ReturnType<typeof getUser>;", errors: 1},
		{
			name: 'parenthesized',
			code: "import {getUser} from './users.ts';\nexport type User = (NonNullable<(ReturnType<typeof getUser>)>);",
			errors: 1
		},
		{
			name: 'aliased import',
			code: "import {getUser as load} from './users.ts';\nexport type User = NonNullable<Awaited<ReturnType<typeof load>>>;",
			errors: 1
		},
		{
			name: 'InstanceType',
			code: "import {Store} from './store.ts';\nexport type S = InstanceType<typeof Store>;",
			errors: 1
		},
		{
			name: 'inside an exported namespace',
			code: "import {getUser} from './users.ts';\nexport namespace Users {\n\texport type User = ReturnType<typeof getUser>;\n}",
			errors: 1
		},
		{
			name: 'exported later',
			code: "import {getUser} from './users.ts';\ntype User = ReturnType<typeof getUser>;\nexport {User};",
			errors: 1
		},
		{
			name: 'exported later as type',
			code: "import {getUser} from './users.ts';\ntype User = ReturnType<typeof getUser>;\nexport type {User as Account};",
			errors: 1
		}
	]
});
