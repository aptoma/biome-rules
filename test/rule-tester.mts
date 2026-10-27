import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {after, before, describe, it} from 'node:test';
import {promisify} from 'node:util';
import {expect} from 'expect';

const execFileAsync = promisify(execFile);
const BIOME_BIN = path.resolve(import.meta.dirname, '../node_modules/.bin/biome');
const RULES_DIR = path.resolve(import.meta.dirname, '../rules');

type ValidCase = string | {code: string; name?: string; filename?: string};
type InvalidCase = {code: string; errors: number; output?: string; name?: string; filename?: string};

export type RuleCases = {
	valid: readonly ValidCase[];
	invalid: readonly InvalidCase[];
};

type Fixture = {file: string; name: string; code: string; errors: number; output?: string};

type BiomeDiagnostic = {
	severity: string;
	message: string;
	category: string;
	location: {path: string | null};
};

function isBiomeReport(value: unknown): value is {diagnostics: BiomeDiagnostic[]} {
	return typeof value === 'object' && value !== null && 'diagnostics' in value && Array.isArray(value.diagnostics);
}

async function runBiome(cwd: string, args: readonly string[]): Promise<string> {
	try {
		const {stdout} = await execFileAsync(BIOME_BIN, args, {cwd, maxBuffer: 64 * 1024 * 1024});
		return stdout;
	} catch (error) {
		// Biome exits non-zero when it reports errors; the JSON report is still on stdout.
		const stdout = error instanceof Error && 'stdout' in error ? error.stdout : undefined;
		if (typeof stdout === 'string' && stdout.startsWith('{')) return stdout;
		throw error;
	}
}

async function lintFixtures(dir: string, extraArgs: readonly string[] = []): Promise<BiomeDiagnostic[]> {
	const stdout = await runBiome(dir, [
		'lint',
		'--only=plugin',
		'--reporter=json',
		'--max-diagnostics=none',
		...extraArgs,
		'.'
	]);
	const report: unknown = JSON.parse(stdout);
	if (!isBiomeReport(report)) throw new Error(`Unexpected Biome report: ${stdout.slice(0, 500)}`);
	return report.diagnostics;
}

/**
 * Lints each case as its own file with only `ruleFile` loaded as a Biome plugin. Invalid cases assert the number of
 * plugin diagnostics; cases with `output` also apply fixes (including unsafe ones) and compare the result.
 */
export function testRule(ruleFile: string, cases: RuleCases): void {
	const fixtures: Fixture[] = [
		...cases.valid.map((valid, index) => {
			const entry = typeof valid === 'string' ? {code: valid} : valid;
			return {
				file: `valid-${index}${path.extname(entry.filename ?? 'x.ts')}`,
				name: entry.name ?? entry.code,
				code: entry.code,
				errors: 0
			};
		}),
		...cases.invalid.map((invalid, index) => ({
			file: `invalid-${index}${path.extname(invalid.filename ?? 'x.ts')}`,
			name: invalid.name ?? invalid.code,
			code: invalid.code,
			errors: invalid.errors,
			output: invalid.output
		}))
	];
	let dir = '';
	let fixDir = '';
	let diagnosticsByFile = new Map<string, BiomeDiagnostic[]>();
	const fixedFiles = new Map<string, string>();

	describe(path.basename(ruleFile, '.ts'), () => {
		before(async () => {
			dir = await fs.mkdtemp(path.join(os.tmpdir(), 'biome-plugin-'));
			fixDir = path.join(dir, 'fix');
			const config = JSON.stringify({plugins: [path.join(RULES_DIR, ruleFile)]});
			await fs.mkdir(path.join(dir, 'lint'));
			await fs.mkdir(fixDir);
			await fs.writeFile(path.join(dir, 'lint', 'biome.json'), config);
			await fs.writeFile(path.join(fixDir, 'biome.json'), config);
			for (const fixture of fixtures) {
				await fs.writeFile(path.join(dir, 'lint', fixture.file), fixture.code);
				if (fixture.output !== undefined) await fs.writeFile(path.join(fixDir, fixture.file), fixture.code);
			}

			const diagnostics = await lintFixtures(path.join(dir, 'lint'));
			const pluginFailures = diagnostics.filter(
				(diagnostic) => diagnostic.category !== 'plugin' || diagnostic.severity !== 'error'
			);
			if (pluginFailures.length > 0) {
				throw new Error(`Unexpected diagnostics:\n${pluginFailures.map((d) => d.message).join('\n')}`);
			}
			diagnosticsByFile = Map.groupBy(diagnostics, (diagnostic) => path.basename(diagnostic.location.path ?? ''));

			if (fixtures.some((fixture) => fixture.output !== undefined)) {
				await lintFixtures(fixDir, ['--write', '--unsafe']);
				for (const fixture of fixtures) {
					if (fixture.output === undefined) continue;
					fixedFiles.set(fixture.file, await fs.readFile(path.join(fixDir, fixture.file), 'utf8'));
				}
			}
		});

		after(async () => {
			await fs.rm(dir, {recursive: true, force: true});
		});

		for (const fixture of fixtures) {
			it(`${fixture.file}: ${fixture.name}`, () => {
				const messages = (diagnosticsByFile.get(fixture.file) ?? []).map((diagnostic) => diagnostic.message);
				expect({code: fixture.code, messages: messages.length === fixture.errors ? fixture.errors : messages}).toEqual({
					code: fixture.code,
					messages: fixture.errors
				});
				if (fixture.output !== undefined) expect(fixedFiles.get(fixture.file)).toBe(fixture.output);
			});
		}
	});
}
