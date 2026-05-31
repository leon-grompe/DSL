import { AstUtils, EmptyFileSystem } from 'langium';
import { describe, expect, it } from 'vitest';
import {
    isSdsYield,
    isSdsPlaceholder,
    isSdsModule,
    SdsPipeline,
    SdsSegment,
    SdsAssignment,
    SdsPlaceholder,
} from '../../../../src/language/generated/ast.js';
import { createSafeDsServices, getModuleMembers } from '../../../../src/language/index.js';
import { getAssignees } from '../../../../src/language/helpers/nodeProperties.js';
import { getNodeOfType } from '../../../helpers/nodeFinder.js';

const services = (await createSafeDsServices(EmptyFileSystem, { omitBuiltins: true })).SafeDs;
const nodeMapper = services.helpers.NodeMapper;

// Shared parse for the main test cases
const code = `
    segment mySegment() -> (r1: Int, r2: Int) {
        yield r1 = 1;
        yield r2 = 2;
    }
    pipeline myPipeline {
        val a, val b = mySegment();
    }
`;
const module = await getNodeOfType(services, code, isSdsModule);
const segment = getModuleMembers(module)[0] as SdsSegment;
const pipeline = getModuleMembers(module)[1] as SdsPipeline;
const assignment = pipeline.body.statements[0] as SdsAssignment;
const callSiteAssignees = getAssignees(assignment);
const [yieldR1, yieldR2] = AstUtils.streamAllContents(segment).filter(isSdsYield).toArray();

describe('SafeDsNodeMapper', () => {
    describe('yieldToCallSiteAssignee', () => {
        it('should return undefined if the result index exceeds the call-site assignees', async () => {
            const code = `
                segment mySegment() -> r1: Int {
                    yield r1 = 1;
                }
            `;
            const yieldStmt = await getNodeOfType(services, code, isSdsYield);
            expect(nodeMapper.yieldToCallSiteAssignee(yieldStmt, [])).toBeUndefined();
        });

        it('should return the first call-site assignee for a yield at result index 0', () => {
            const assignee = nodeMapper.yieldToCallSiteAssignee(yieldR1!, callSiteAssignees);
            expect(assignee).toBe(callSiteAssignees[0]);
            expect(isSdsPlaceholder(assignee)).toBe(true);
            expect((assignee as SdsPlaceholder).name).toBe('a');
        });

        it('should return the second call-site assignee for a yield at result index 1', () => {
            const assignee = nodeMapper.yieldToCallSiteAssignee(yieldR2!, callSiteAssignees);
            expect(assignee).toBe(callSiteAssignees[1]);
            expect(isSdsPlaceholder(assignee)).toBe(true);
            expect((assignee as SdsPlaceholder).name).toBe('b');
        });

        it('should return undefined when the result index has no corresponding call-site assignee', () => {
            const onlyFirstAssignee = callSiteAssignees.slice(0, 1);
            expect(nodeMapper.yieldToCallSiteAssignee(yieldR2!, onlyFirstAssignee)).toBeUndefined();
        });

        it('should return a yield assignee when the call site is inside a segment', async () => {
            // When inner() is called inside a segment, the call-site assignees are yields, not placeholders.
            // The slicer uses this to bubble reached yields up through nested segments.
            const code = `
                segment inner() -> r1: Int {
                    yield r1 = 1;
                }
                segment outer() -> outerResult: Int {
                    yield outerResult = inner();
                }
            `;
            const module = await getNodeOfType(services, code, isSdsModule);
            const innerSegment = getModuleMembers(module)[0] as SdsSegment;
            const outerSegment = getModuleMembers(module)[1] as SdsSegment;

            const outerYield = AstUtils.streamAllContents(outerSegment).filter(isSdsYield).toArray()[0]!;
            const innerYield = AstUtils.streamAllContents(innerSegment).filter(isSdsYield).toArray()[0]!;

            const assignee = nodeMapper.yieldToCallSiteAssignee(innerYield, [outerYield]);
            expect(assignee).toBe(outerYield);
            expect(isSdsPlaceholder(assignee)).toBe(false);
            expect(isSdsYield(assignee)).toBe(true);
        });
    });
});
