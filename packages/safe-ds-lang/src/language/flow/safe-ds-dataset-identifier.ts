import { AstNode, AstUtils } from 'langium';
import { SafeDsServices } from '../safe-ds-module.js';
import { isSdsAssignment, isSdsCall, isSdsPlaceholder, isSdsReference, isSdsMemberAccess, isSdsSegment, isSdsStatement, isSdsYield,
         SdsPlaceholder, SdsCall, SdsStatement, SdsAssignment, SdsSegment, SdsReference, SdsExpression, SdsLocalVariable } from '../generated/ast.js';
import { getAssignees } from '../helpers/nodeProperties.js';

export enum DataSet {
    /** Fallback dataset, used when dataset cannot be identified. */
    Fallback   = 'Unidentified',
    /** Training dataset, assigned by the first split call at position 0. */
    Training   = 'Training',
    /** Validation dataset, assigned by the second split call at position 0. */
    Validation = 'Validation',
    /** Test dataset, assigned by either first or second split call at position 1. */
    Test       = 'Test',
}

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

        return Boolean(this.findReferenceInForwardSliceOfTarget(call, trainingSet));
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

        return Boolean(this.findReferenceInForwardSliceOfTarget(call, validationSet));
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

        return Boolean(this.findReferenceInForwardSliceOfTarget(call, testSet));
    }

    /**
     * Returns which dataset partition 'call' operates on, or undefined if it cannot be determined.
     */
    identifyDataset(call: SdsCall, statements: SdsStatement[]): DataSet | undefined {
        return this.getDatasetOfCall(call, statements)?.dataset;
    }

    /**
     * Returns which dataset partition 'call' operates on together with the reference that determined it.
     * Checks Training → Validation → Test (same precedence as identifyDataset) and returns the first match.
     */
    getDatasetOfCall(call: SdsCall, statements: SdsStatement[]): { dataset: DataSet; reference: SdsReference } | undefined {
        for (const dataset of [DataSet.Training, DataSet.Validation, DataSet.Test]) {
            const root = this.getRootPlaceholder(statements, dataset);
            if (!root) continue;

            const reference = this.findReferenceInForwardSliceOfTarget(call, root);
            if (reference) return { dataset, reference };
        }
        return undefined;
    }

    /**
     * Returns the partition a call operates on, considering only its data-typed argument references
     * (ignoring e.g. transformer arguments). Used to attribute a segment invocation to the partition of
     * its data argument, since the segment body's own calls reference the partition-agnostic parameter,
     * which is reachable from every partition the segment is invoked with. Checks Training → Validation →
     * Test and returns the first match.
     */
    datasetOfDataArguments(call: SdsCall, statements: SdsStatement[]): DataSet | undefined {
        for (const dataset of [DataSet.Training, DataSet.Validation, DataSet.Test]) {
            const root = this.getRootPlaceholder(statements, dataset);
            if (!root) continue;

            const forwardSlice = this.services.flow.Slicer.computeForwardSliceFromVariable(root);
            for (const argument of call.argumentList.arguments) {
                const value = argument.value;
                if (!isSdsReference(value)) continue;
                const reference = value.target.ref;
                // only data-typed args (the partition itself) count; transformer args are fit on the
                // training set and would otherwise pull every invocation to Training by precedence
                if (!isSdsPlaceholder(reference) || !this.services.flow.DataFlowAnalyzer.isData(reference)) continue;
                if (forwardSlice.some((variable) => variable === reference)) return dataset;
            }
        }
        return undefined;
    }

    /**
     * Returns the reference of 'call' that is derived from the given 'dataset' (its receiver-chain root
     * or a data-typed argument), or undefined if none. Unlike getDatasetOfCall this targets a specific
     * dataset, so it picks the right argument even when the call references several partitions.
     */
    findDatasetReferenceInCall(call: SdsCall, statements: SdsStatement[], dataset: DataSet): SdsReference | undefined {
        const root = this.getRootPlaceholder(statements, dataset);
        if (!root) return undefined;

        return this.findReferenceInForwardSliceOfTarget(call, root);
    }

    /**
     * Returns the most specific variable of 'dataset' that is available before 'before':
     * the latest-derived placeholder declared in a statement preceding the one containing 'before',
     * or the dataset's root placeholder if nothing derived qualifies. Undefined if the dataset has no
     * placeholder in this pipeline.
     */
    getMostSpecificDatasetPlaceholder(statements: SdsStatement[], dataset: DataSet, before: AstNode): SdsPlaceholder | undefined {
        const root = this.getRootPlaceholder(statements, dataset);
        if (!root) return undefined;

        const beforeOffset = AstUtils.getContainerOfType(before, isSdsStatement)?.$cstNode?.offset;
        if (beforeOffset === undefined) return root;

        let best: SdsPlaceholder = root;
        let bestOffset = AstUtils.getContainerOfType(root, isSdsStatement)?.$cstNode?.offset ?? -1;

        for (const variable of this.services.flow.Slicer.computeForwardSliceFromVariable(root)) {
            if (!isSdsPlaceholder(variable)) continue;

            // only pipeline-level placeholders declared in an earlier statement are usable here
            const statement = AstUtils.getContainerOfType(variable, isSdsStatement);
            if (!statement || !statements.includes(statement)) continue;

            const offset = statement.$cstNode?.offset;
            if (offset === undefined || offset >= beforeOffset) continue;

            if (offset > bestOffset) {
                best = variable;
                bestOffset = offset;
            }
        }
        return best;
    }

    /**
     * Returns every holdout data variable — the validation and test sets, plus the rest pool they
     * were carved from — each including its root placeholder and everything derived from it.
     * Training and original data are not included (their lenses are always shown).
     */
    getHoldoutVariables(statements: SdsStatement[]): Set<SdsLocalVariable> {
        const result = new Set<SdsLocalVariable>();
        const addSlice = (root: SdsPlaceholder | undefined) => {
            if (!root) return;
            for (const variable of this.services.flow.Slicer.computeForwardSliceFromVariable(root)) {
                result.add(variable);
            }
        };

        // Validation/test slices are subsets of the rest slice in the two-split case, but the
        // split-all-segment case has no genuine rest placeholder, so all three roots are needed.
        addSlice(this.getRestSetPlaceholder(statements));
        addSlice(this.getRootPlaceholder(statements, DataSet.Validation));
        addSlice(this.getRootPlaceholder(statements, DataSet.Test));
        return result;
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

    /**
     * Returns the rest-set placeholder only when it is genuinely a rest set, i.e. it is split a
     * second time into validation/test. In a single-split pipeline the second assignee is the test
     * set, not a rest set, so this returns undefined and callers must not treat it as one.
     */
    getChainedRestSetPlaceholder(statements: SdsStatement[]): SdsPlaceholder | undefined {
        return this.getValidationSplitAssignment(statements) ? this.getRestSetPlaceholder(statements) : undefined;
    }

    /**
     * Returns the first and second placeholder assignees of a split assignment.
     */
    private getSplitAssignees(assignment: SdsAssignment): [SdsPlaceholder | undefined, SdsPlaceholder | undefined] {
        const assignees = getAssignees(assignment);
        const first  = isSdsPlaceholder(assignees[0]) ? assignees[0] : undefined;
        const second = isSdsPlaceholder(assignees[1]) ? assignees[1] : undefined;
        
        return [first, second];
    }

    /**
     * Returns the placeholder that represents the rest set.
     * This is the "rest" that is split further into validation/test.
     */
    private getRestSetPlaceholder(statements: SdsStatement[]): SdsPlaceholder | undefined {
        const firstSplit = this.services.flow.DataFlowAnalyzer.extractAssignmentsWithSpecificCall(statements, 'split')[0];
        if (!firstSplit) return undefined;
        
        return this.getSplitAssignees(firstSplit)[1];
    }

    /**
     * Finds the split assignment (after the first) that consumes the rest set.
     * Handles two cases:
     *   - Direct call:   rest.split()          -> check member-access receiver
     *   - Segment call:  splitData(rest, ...)  -> check if restSet appears in arguments
     */
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

    /**
     * Returns the reference of 'call' that is derived from 'target' (the receiver-chain root if it is in
     * the forward slice of 'target', otherwise the first data-typed argument reference that is), or
     * undefined if none. This is the reference that identifies which dataset the call operates on.
     */
    private findReferenceInForwardSliceOfTarget(call: SdsCall, target: SdsPlaceholder): SdsReference | undefined {
        const forwardSlice = this.services.flow.Slicer.computeForwardSliceFromVariable(target);

        // Check the root of the receiver chain. This covers a direct receiver ('training.toTabularDataset(...)')
        // as well as a chained one ('training.transformTable(a).transformTable(b).toTabularDataset(...)'),
        // where every call in the chain operates on the data that enters at the bottom of the chain.
        // Membership in the forward slice is the actual filter: it only ever contains data-typed
        // local variables derived from 'target' — which includes segment parameters, not just
        // placeholders — so we compare against it directly rather than restricting to placeholders.
        const receiverRoot = this.receiverChainRoot(call);
        if (receiverRoot && forwardSlice.some(v => v === receiverRoot.target.ref)) return receiverRoot;

        for (const arg of call.argumentList.arguments) {
            const value = arg.value;
            if (!isSdsReference(value)) continue;
            if (forwardSlice.some(v => v === value.target.ref)) return value;
        }
        return undefined;
    }

    /**
     * Returns the root placeholder of a dataset partition, or undefined for Fallback / when absent.
     */
    private getRootPlaceholder(statements: SdsStatement[], dataset: DataSet): SdsPlaceholder | undefined {
        switch (dataset) {
            case DataSet.Training:   return this.getTrainingSetPlaceholder(statements);
            case DataSet.Validation: return this.getValidationSetPlaceholder(statements);
            case DataSet.Test:       return this.getTestSetPlaceholder(statements);
            case DataSet.Fallback:   return undefined;
        }
    }

    /**
     * Walks down the receiver chain of a call to its root reference. For a chained call such as
     * 'table.transformTable(a).transformTable(b).toTabularDataset(...)' the receiver is a chain of
     * member accesses and calls bottoming out in the 'table' reference, which identifies the data the
     * whole chain operates on. Returns undefined if the chain does not bottom out in a plain reference.
     */
    private receiverChainRoot(call: SdsCall): SdsReference | undefined {
        let current: SdsExpression = call.receiver;
        while (isSdsMemberAccess(current) || isSdsCall(current)) {
            current = current.receiver;
        }
        return isSdsReference(current) ? current : undefined;
    }

    /**
     * Checks if the first split assignment is a "split-all" segment: a single segment call that
     * internally performs both the training/rest and validation/test splits. If so, returns the
     * pipeline-level placeholders for training, validation, and test mapped via yield statements.
     * Returns undefined for the direct-split case (Scenario A).
     */
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

    /**
     * Finds the yield in 'segment' whose parent assignment's expression is a direct reference to
     * 'internalPlaceholder', then maps it to the corresponding pipeline-level assignee at the call site.
     */
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