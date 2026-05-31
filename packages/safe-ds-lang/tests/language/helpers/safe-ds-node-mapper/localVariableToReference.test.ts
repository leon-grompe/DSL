import { EmptyFileSystem } from 'langium';
import { describe, expect, it } from 'vitest';
import { isSdsParameter, isSdsPlaceholder } from '../../../../src/language/generated/ast.js';
import { createSafeDsServices } from '../../../../src/language/index.js';
import { getNodeOfType } from '../../../helpers/nodeFinder.js';

const services = (await createSafeDsServices(EmptyFileSystem, { omitBuiltins: true })).SafeDs;
const nodeMapper = services.helpers.NodeMapper;

describe('SafeDsNodeMapper', () => {
    describe('localVariableToReference', () => {
        it('should return an empty stream if passed undefined', () => {
            expect(nodeMapper.localVariableToReference(undefined).toArray()).toStrictEqual([]);
        });

        describe('parameter', () => {
            it.each([
                {
                    description: 'no references',
                    code: `segment mySegment(p1: Int) {}`,
                },
                {
                    description: 'reference in default value',
                    code: `fun f(p1: Int, p2: Int = p1)`,
                },
                {
                    description: 'references directly in body',
                    code: `segment mySegment(p1: Int) { p1; p1; }`,
                },
                {
                    description: 'references nested in body',
                    code: `segment mySegment(p1: Int) { () { p1; }; () -> p1; }`,
                },
                {
                    description: 'reference in own parameter list',
                    code: `segment mySegment(p1: Int, p2: Int = p1) {}`,
                },
            ])('should delegate to parameterToReferences: $description', async ({ code }) => {
                const param = await getNodeOfType(services, code, isSdsParameter);
                expect(nodeMapper.localVariableToReference(param).toArray()).toStrictEqual(
                    nodeMapper.parameterToReferences(param).toArray(),
                );
            });
        });

        describe('placeholder', () => {
            it.each([
                {
                    description: 'no references',
                    code: `pipeline myPipeline { val a = 1; }`,
                },
                {
                    description: 'reference in default value',
                    code: `segment mySegment() { val a1 = 1; (p1: Int = a1) -> 1; }`,
                },
                {
                    description: 'references directly in body',
                    code: `pipeline myPipeline { val a = 1; a; a; }`,
                },
                {
                    description: 'references nested in body',
                    code: `segment mySegment() { () { val a1 = 1; () { a1; }; () -> a1; }; }`,
                },
                {
                    description: 'references in nested parameter list',
                    code: `segment mySegment() { val a1 = 1; (p2: Int = a1) {}; (p2: Int = a1) -> 1; }`,
                },
            ])('should delegate to placeholderToReferences: $description', async ({ code }) => {
                const placeholder = await getNodeOfType(services, code, isSdsPlaceholder);
                expect(nodeMapper.localVariableToReference(placeholder).toArray()).toStrictEqual(
                    nodeMapper.placeholderToReferences(placeholder).toArray(),
                );
            });
        });
    });
});
