import { AstUtils } from 'langium';
import { describe, expect, it } from 'vitest';
import { isSdsPlaceholder, isSdsPipeline } from '../../../src/language/generated/ast.js';
import { createSafeDsServices } from '../../../src/language/index.js';
import { NodeFileSystem } from 'langium/node';
import { fail } from 'node:assert';
import { getNodeOfType } from '../../helpers/nodeFinder.js';

const services = (await createSafeDsServices(NodeFileSystem)).SafeDs;
const slicer = services.flow.Slicer;

describe('computeForwardSliceFromVariable', async () => {
    const testCases: ComputeForwardSliceTest[] = [
        {
            testName: 'non-data variable returns empty',
            code: `
                package test
                fun getInt() -> result: Int
                pipeline myPipeline {
                    val a = getInt();
                    val b = a;
                }
            `,
            startName: 'a',
            expectedNames: [],
        },
        {
            testName: 'data variable with no downstream',
            code: `
                package test
                fun getTable() -> result: Table
                pipeline myPipeline {
                    val a = getTable();
                }
            `,
            startName: 'a',
            expectedNames: ['a'],
        },
        {
            testName: 'direct reference',
            code: `
                package test
                fun getTable() -> result: Table
                pipeline myPipeline {
                    val a = getTable();
                    val b = a;
                }
            `,
            startName: 'a',
            expectedNames: ['a', 'b'],
        },
        {
            testName: 'chain of references',
            code: `
                package test
                fun getTable() -> result: Table
                pipeline myPipeline {
                    val a = getTable();
                    val b = a;
                    val c = b;
                }
            `,
            startName: 'a',
            expectedNames: ['a', 'b', 'c'],
        },
        {
            testName: 'unrelated variable not included',
            code: `
                package test
                fun getTable() -> result: Table
                pipeline myPipeline {
                    val a = getTable();
                    val b = getTable();
                    val c = a;
                }
            `,
            startName: 'a',
            expectedNames: ['a', 'c'],
        },
        {
            testName: 'non-data downstream not included',
            code: `
                package test
                fun getTable() -> result: Table
                fun countRows(t: Table) -> result: Int
                pipeline myPipeline {
                    val a = getTable();
                    val n = countRows(a);
                }
            `,
            startName: 'a',
            expectedNames: ['a'],
        },
        {
            testName: 'through function call',
            code: `
                package test
                fun getTable() -> result: Table
                fun transform(t: Table) -> result: Table
                pipeline myPipeline {
                    val a = getTable();
                    val b = transform(a);
                }
            `,
            startName: 'a',
            expectedNames: ['a', 'b'],
        },
        {
            testName: 'through segment call',
            code: `
                package test
                fun getTable() -> result: Table
                segment process(t: Table) -> result: Table {
                    yield result = t;
                }
                pipeline myPipeline {
                    val a = getTable();
                    val b = process(a);
                }
            `,
            startName: 'a',
            // 't' is the segment parameter reached from 'a'; 'b' is the call-site output
            expectedNames: ['a', 't', 'b'],
        },
        {
            testName: 'only relevant output from multi-output segment',
            code: `
                package test
                fun getTable() -> result: Table
                segment split(train: Table, test: Table) -> (out1: Table, out2: Table) {
                    yield out1 = train;
                    yield out2 = test;
                }
                pipeline myPipeline {
                    val a = getTable();
                    val b = getTable();
                    val x, val y = split(a, b);
                }
            `,
            startName: 'a',
            // 'train' is the segment param reached from 'a'; 'x' is out1's call-site assignee
            // 'y' is out2's call-site assignee, which depends on 'b' not 'a' — excluded
            expectedNames: ['a', 'train', 'x'],
        },
    ];

    it.each(testCases)('$testName', async ({ code, startName, expectedNames }) => {
        const pipeline = await getNodeOfType(services, code, isSdsPipeline);
        const start =
            AstUtils.streamAllContents(pipeline)
                .filter(isSdsPlaceholder)
                .find((p) => p.name === startName) ?? fail(`Placeholder '${startName}' not found in pipeline.`);

        const result = slicer.computeForwardSliceFromVariable(start);
        const actualNames = result.map((v) => v.name).sort();

        expect(actualNames).toStrictEqual([...expectedNames].sort());
    });
});

/**
 * A test case for {@link SafeDsSlicer.computeForwardSliceFromVariable}.
 */
interface ComputeForwardSliceTest {
    testName: string;
    code: string;
    startName: string;
    expectedNames: string[];
}
