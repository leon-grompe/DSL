import { AstUtils } from 'langium';
import { SafeDsServices } from '../safe-ds-module.js';
import { isSdsAssignment, isSdsCall, isSdsPlaceholder, isSdsReference, isSdsMemberAccess, isSdsSegment, isSdsYield,
         SdsPlaceholder, SdsCall, SdsStatement, SdsAssignment, SdsSegment } from '../generated/ast.js';
import { getAssignees } from '../helpers/nodeProperties.js';

export class SafeDsDatasetIdentifier {
    constructor(
        private services: SafeDsServices
    ) {}

    /**
     * Returns true if any data-typed reference argument of 'call' is derived from the training set.
     */
    callReferencesTrainingSet(call: SdsCall, statements: SdsStatement[]): boolean {
        const trainingSet = this.getTrainingSetPlaceholder(statements);
        if (!trainingSet) return false;
            
        return this.anyArgInForwardSliceOfTarget(call, trainingSet);
    }

    /**
     * Returns the placeholder that represents the training set.
     * Scenario A: assignee[0] of the first split call.
     * Scenario B: first output of a segment that does the full split internally.
     */
    getTrainingSetPlaceholder(statements: SdsStatement[]): SdsPlaceholder | undefined {
        const splitAll = this.tryGetSplitAllDatasets(statements);
        if (splitAll) return splitAll.training;

        const firstSplit = this.services.flow.DataFlowAnalyzer.extractAssignmentsWithSpecificCall(statements, 'split')[0];
        if (!firstSplit) return undefined;
        
        return this.getSplitAssignees(firstSplit)[0];
    }

    /**
     * Returns true if any data-typed reference argument of 'call' is derived from the validation set.
     */
    callReferencesValidationSet(call: SdsCall, statements: SdsStatement[]): boolean {
        const validationSet = this.getValidationSetPlaceholder(statements);
        if (!validationSet) return false;
        
        return this.anyArgInForwardSliceOfTarget(call, validationSet);
    }

    /**
     * Returns the placeholder that represents the validation set.
     * Scenario A: assignee[0] of the second split (after the first) whose receiver/argument is a direct reference to the rest set.
     * Scenario B: second output of a segment that does the full split internally.
     */
    getValidationSetPlaceholder(statements: SdsStatement[]): SdsPlaceholder | undefined {
        const splitAll = this.tryGetSplitAllDatasets(statements);
        if (splitAll) return splitAll.validation;

        const validationSplit = this.getValidationSplitAssignment(statements);
        if (!validationSplit) return undefined;
        
        return this.getSplitAssignees(validationSplit)[0];
    }

    /**
     * Returns true if any data-typed reference argument of 'call' is derived from the test set.
     */
    callReferencesTestSet(call: SdsCall, statements: SdsStatement[]): boolean {
        const testSet = this.getTestSetPlaceholder(statements);
        if (!testSet) return false;
        
        return this.anyArgInForwardSliceOfTarget(call, testSet);
    }

    /**
     * Returns the placeholder that represents the test set.
     * Scenario A: assignee[1] of the validation split, or the rest set if no validation split exists.
     * Scenario B: third output of a segment that does the full split internally.
     */
    getTestSetPlaceholder(statements: SdsStatement[]): SdsPlaceholder | undefined {
        const splitAll = this.tryGetSplitAllDatasets(statements);
        if (splitAll) return splitAll.test;

        const validationSplit = this.getValidationSplitAssignment(statements);
        if (validationSplit) return this.getSplitAssignees(validationSplit)[1];
        
        return this.getRestSetPlaceholder(statements);
    }


    // Returns the first and second placeholder assignees of a split assignment.
    private getSplitAssignees(assignment: SdsAssignment): [SdsPlaceholder | undefined, SdsPlaceholder | undefined] {
        const assignees = getAssignees(assignment);
        const first  = isSdsPlaceholder(assignees[0]) ? assignees[0] : undefined;
        const second = isSdsPlaceholder(assignees[1]) ? assignees[1] : undefined;
        
        return [first, second];
    }

    // assignee[1] of the first split, the "rest" that is split further into validation/test.
    private getRestSetPlaceholder(statements: SdsStatement[]): SdsPlaceholder | undefined {
        const firstSplit = this.services.flow.DataFlowAnalyzer.extractAssignmentsWithSpecificCall(statements, 'split')[0];
        if (!firstSplit) return undefined;
        
        return this.getSplitAssignees(firstSplit)[1];
    }

    // Finds the split assignment (after the first) that consumes the rest set.
    // Handles two cases:
    //   - Direct call:   rest.split()          -> check member-access receiver
    //   - Segment call:  splitData(rest, ...)  -> check if restSet appears in arguments
    private getValidationSplitAssignment(statements: SdsStatement[]): SdsAssignment | undefined {
        const restSet = this.getRestSetPlaceholder(statements);
        if (!restSet) return undefined;

        // extractAssignmentsWithSpecificCall finds both direct split calls and 
        // segment calls that contain a split internally, so we don't use isSpecificCall here.
        const splitAssignments = this.services.flow.DataFlowAnalyzer.extractAssignmentsWithSpecificCall(statements, 'split');

        // Index 0 is the training/rest split — start from 1.
        for (let i = 1; i < splitAssignments.length; i++) {
            const assignment = splitAssignments[i];
            if (!assignment || !isSdsCall(assignment.expression)) continue;
            const call = assignment.expression;

            if (this.services.flow.DataFlowAnalyzer.isSpecificCall(assignment, 'split')) {
                // Direct split: rest.split() — restSet is the member-access base
                if (isSdsMemberAccess(call.receiver)) {
                    const base = call.receiver.receiver;
                    if (isSdsReference(base) && base.target.ref === restSet) return assignment;
                }
            } else {
                // Segment call containing a split: check if restSet is passed as an argument
                if (call.argumentList.arguments.some(
                    arg => isSdsReference(arg.value) && arg.value.target.ref === restSet
                )) {
                    return assignment;
                }
            }
        }
        return undefined;
    }

    // Returns true if any data-typed reference argument of 'call' is in the forward slice of 'target'.
    private anyArgInForwardSliceOfTarget(call: SdsCall, target: SdsPlaceholder): boolean {
        const forwardSlice = this.services.flow.Slicer.computeForwardSliceFromVariable(target);
        return call.argumentList.arguments.some(arg => {
            if (!isSdsReference(arg.value)) return false;
            const ref = arg.value.target.ref;
            return isSdsPlaceholder(ref) && forwardSlice.some(v => v === ref);
        });
    }

    // Checks if the first split assignment is a "split-all" segment: a single segment call that
    // internally performs both the training/rest and validation/test splits. If so, returns the
    // pipeline-level placeholders for training, validation, and test mapped via yield statements.
    // Returns undefined for the direct-split case (Scenario A).
    private tryGetSplitAllDatasets(
        statements: SdsStatement[],
    ): { training: SdsPlaceholder | undefined; validation: SdsPlaceholder | undefined; test: SdsPlaceholder | undefined } | undefined {
        const firstSplitAssignment = this.services.flow.DataFlowAnalyzer.extractAssignmentsWithSpecificCall(statements, 'split')[0];
        if (!firstSplitAssignment || !isSdsCall(firstSplitAssignment.expression)) return undefined;

        // Only applies to segment calls — direct splits are handled by the normal Scenario A path.
        if (this.services.flow.DataFlowAnalyzer.isSpecificCall(firstSplitAssignment, 'split')) return undefined;

        const callable = this.services.helpers.NodeMapper.callToCallable(firstSplitAssignment.expression);
        if (!isSdsSegment(callable) || !callable.body) return undefined;

        const segmentStatements = callable.body.statements;

        // Recursively identify training/validation/test inside the segment body.
        // All three must be present for this to qualify as a split-all segment.
        const internalTraining   = this.getTrainingSetPlaceholder(segmentStatements);
        const internalValidation = this.getValidationSetPlaceholder(segmentStatements);
        const internalTest       = this.getTestSetPlaceholder(segmentStatements);

        if (!internalTraining || !internalValidation || !internalTest) return undefined;

        // Map each internal placeholder to the pipeline-level assignee via yield statements.
        const callSiteAssignees = getAssignees(firstSplitAssignment);
        return {
            training:   this.mapInternalToCallSiteAssignee(internalTraining,   callable, callSiteAssignees),
            validation: this.mapInternalToCallSiteAssignee(internalValidation, callable, callSiteAssignees),
            test:       this.mapInternalToCallSiteAssignee(internalTest,       callable, callSiteAssignees),
        };
    }

    // Finds the yield in 'segment' whose parent assignment's expression is a direct reference to
    // 'internalPlaceholder', then maps it to the corresponding pipeline-level assignee at the call site.
    private mapInternalToCallSiteAssignee(
        internalPlaceholder: SdsPlaceholder,
        segment: SdsSegment,
        callSiteAssignees: ReturnType<typeof getAssignees>,
    ): SdsPlaceholder | undefined {
        const matchingYield = AstUtils.streamAllContents(segment.body)
            .filter(isSdsYield)
            .find(y => {
                const parentAssignment = AstUtils.getContainerOfType(y, isSdsAssignment);
                if (!parentAssignment) return false;
                const expr = parentAssignment.expression;
                return isSdsReference(expr) && expr.target.ref === internalPlaceholder;
            });

        if (!matchingYield) return undefined;

        const assignee = this.services.helpers.NodeMapper.yieldToCallSiteAssignee(matchingYield, callSiteAssignees);
        
        return isSdsPlaceholder(assignee) ? assignee : undefined;
    }
}