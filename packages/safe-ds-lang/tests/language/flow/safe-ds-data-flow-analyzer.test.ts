import { describe, expect, it } from 'vitest';
import { getNodeOfType } from '../../helpers/nodeFinder.js';
import { isSdsPlaceholder } from '../../../src/language/generated/ast.js';
import { createSafeDsServices } from '../../../src/language/index.js';
import { NodeFileSystem } from 'langium/node';

const services = (await createSafeDsServices(NodeFileSystem)).SafeDs;
const analyzer = services.flow.DataFlowAnalyzer;

describe('SafeDsDataFlowAnalyzer', async () => {
    describe('checkIfPlaceholderIsAssigneeOfSpecificFunction', () => {
        const testCases: CheckIfPlaceholderIsAssigneeTest[] = [
            {
                testName: 'direct splitRows first assignee',
                code: `
                    package test

                    fun getTable() -> table: Table
                    fun foo(t: Table) -> table: Table

                    pipeline myPipeline {
                        val train, val test = getTable().splitRows(0.8);
                    }
                `,
                placeholderIndex: 0,
                functionCallName: 'splitRows',
                correctAssigneePosition: 0,
                expected: true,
            },
            {
                testName: 'direct splitRows second assignee',
                code: `
                    package test

                    fun getTable() -> table: Table
                    fun foo(t: Table) -> table: Table

                    pipeline myPipeline {
                        val train, val test = getTable().splitRows(0.8);
                    }
                `,
                placeholderIndex: 1,
                functionCallName: 'splitRows',
                correctAssigneePosition: 1,
                expected: true,
            },
            {
                testName: 'direct splitRows wrong assignee position',
                code: `
                    package test

                    fun getTable() -> table: Table
                    fun foo(t: Table) -> table: Table

                    pipeline myPipeline {
                        val train, val test = getTable().splitRows(0.8);
                    }
                `,
                placeholderIndex: 0,
                functionCallName: 'splitRows',
                correctAssigneePosition: 1,
                expected: false,
            },
            {
                testName: 'indirect reference to splitRows first assignee',
                code: `
                    package test

                    fun getTable() -> table: Table
                    fun foo(t: Table) -> table: Table

                    pipeline myPipeline {
                        val train, val test = getTable().splitRows(0.8);
                        val x = train;
                    }
                `,
                placeholderIndex: 2,
                functionCallName: 'splitRows',
                correctAssigneePosition: 0,
                expected: true,
            },
            {
                testName: 'nested call uses splitRows first assignee',
                code: `
                    package test

                    fun getTable() -> table: Table
                    fun foo(t: Table) -> table: Table

                    pipeline myPipeline {
                        val train, val test = getTable().splitRows(0.8);
                        val x = foo(train);
                    }
                `,
                placeholderIndex: 2,
                functionCallName: 'splitRows',
                correctAssigneePosition: 0,
                expected: true,
            },
            {
                testName: 'unrelated placeholder is not splitRows assignee',
                code: `
                    package test

                    fun getTable() -> table: Table
                    fun foo(t: Table) -> table: Table

                    pipeline myPipeline {
                        val train, val test = getTable().splitRows(0.8);
                        val unrelated = 42;
                    }
                `,
                placeholderIndex: 2,
                functionCallName: 'splitRows',
                correctAssigneePosition: 0,
                expected: false,
            },
        ];

        it.each(testCases)('$testName', async ({ code, placeholderIndex, functionCallName, correctAssigneePosition, expected }) => {
            const placeholder = await getNodeOfType(services, code, isSdsPlaceholder, placeholderIndex);
            const actual = analyzer.checkIfPlaceholderIsAssigneeOfSpecificFunction(
                placeholder,
                functionCallName,
                correctAssigneePosition,
            );

            expect(actual).toBe(expected);
        });
    });
});

interface CheckIfPlaceholderIsAssigneeTest {
    testName: string;
    code: string;
    placeholderIndex: number;
    functionCallName: string;
    correctAssigneePosition: number;
    expected: boolean;
}
