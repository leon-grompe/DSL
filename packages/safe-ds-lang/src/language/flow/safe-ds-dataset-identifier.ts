import { SafeDsServices } from '../safe-ds-module.js';
import { isSdsAssignment, isSdsPlaceholder, isSdsReference, isSdsMemberAccess,
         SdsPlaceholder, SdsCall, SdsStatement, SdsAssignment } from '../generated/ast.js';
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
     * Returns the placeholder that represents the training set:
     * assignee[0] of the first split call in the pipeline.
     */
    getTrainingSetPlaceholder(statements: SdsStatement[]): SdsPlaceholder | undefined {
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
     * Returns the placeholder that represents the validation set:
     * assignee[0] of the direct split call (after the first) whose member-access receiver
     * is a direct reference to the rest set (assignee[1] of the first split).
     */
    getValidationSetPlaceholder(statements: SdsStatement[]): SdsPlaceholder | undefined {
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
     * If a validation split exists: assignee[1] of that split.
     * Otherwise: assignee[1] of the first split (the rest set).
     */
    getTestSetPlaceholder(statements: SdsStatement[]): SdsPlaceholder | undefined {
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

    // Finds the direct split call (after the first) whose member-access receiver is a direct
    // reference to the rest set. Returns undefined if no such split exists.
    private getValidationSplitAssignment(statements: SdsStatement[]): SdsAssignment | undefined {
        const restSet = this.getRestSetPlaceholder(statements);
        if (!restSet) return undefined;

        let isFirst = true;
        for (const statement of statements) {
            if (!isSdsAssignment(statement) || !this.services.flow.DataFlowAnalyzer.isSpecificCall(statement, 'split')) continue;
            // Skip the first split
            if (isFirst) { isFirst = false; continue; }

            const call = statement.expression as SdsCall;
            if (isSdsMemberAccess(call.receiver)) {
                const base = call.receiver.receiver;
                if (isSdsReference(base) && base.target.ref === restSet) return statement;
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
}