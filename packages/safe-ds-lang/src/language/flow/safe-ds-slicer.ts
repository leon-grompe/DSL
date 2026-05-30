import { SafeDsServices } from '../safe-ds-module.js';
import { isSdsAssignment, isSdsPlaceholder, isSdsReference, isSdsCall, isSdsFunction, isSdsSegment, isSdsYield,
         SdsPlaceholder, SdsStatement, SdsLocalVariable, SdsYield, SdsCall, SdsSegment, SdsReference,
         isSdsStatement,
         SdsAssignment} from '../generated/ast.js';
import { AstUtils, Stream } from 'langium';
import { ImpurityReason } from '../purity/model.js';
import { getAssignees } from '../helpers/nodeProperties.js';
import { SafeDsPurityComputer } from '../purity/safe-ds-purity-computer.js';
import { SafeDsNodeMapper } from '../helpers/safe-ds-node-mapper.js';
import { SafeDsDataFlowAnalyzer } from './safe-ds-data-flow-analyzer.js';

export class SafeDsSlicer {
    private readonly purityComputer: SafeDsPurityComputer;
    private readonly nodeMapper: SafeDsNodeMapper;
    private readonly analyzer: SafeDsDataFlowAnalyzer;

    constructor(services: SafeDsServices) {
        this.purityComputer = services.purity.PurityComputer;
        this.nodeMapper = services.helpers.NodeMapper;
        this.analyzer = services.flow.DataFlowAnalyzer;
    }

    /**
     * Computes the subset of the given statements that are needed to calculate the target placeholders.
     */
    computeBackwardSliceToTargets(statements: SdsStatement[], targets: SdsStatement[]): SdsStatement[] {
        const aggregator = new BackwardSliceAggregator(this.purityComputer);

        for (const statement of statements.reverse()) {
            // Keep if it is a target
            if (targets.includes(statement)) {
                aggregator.addStatement(statement);
            }

            // Keep if it declares a referenced placeholder
            else if (
                isSdsAssignment(statement) &&
                getAssignees(statement).some((it) => isSdsPlaceholder(it) && aggregator.referencedPlaceholders.has(it))
            ) {
                aggregator.addStatement(statement);
            }

            // Keep if it has an impurity reason that affects a future impurity reason
            else if (
                this.purityComputer
                    .getImpurityReasonsForStatement(statement)
                    .some((pastReason) =>
                        aggregator.impurityReasons.some((futureReason) =>
                            pastReason.canAffectFutureImpurityReason(futureReason),
                        ),
                    )
            ) {
                aggregator.addStatement(statement);
            }
        }

        return aggregator.statements;
    }

    /**
     * Computes the subset of the given statements that are needed to calculate the target placeholders without recording impurity reasons.
     */
    computeBackwardSliceToTargetsWithoutPurity(statements: SdsStatement[], targets: SdsStatement[]): SdsStatement[]{
        const aggregator = new BackwardSliceAggregator(this.purityComputer);


        for (const statement of statements.reverse()) {
            // Keep if it is a target
            if (targets.includes(statement)) {
                aggregator.addStatementWithoutPurity(statement);
            }

            // Keep if it declares a referenced placeholder
            else if (
                isSdsAssignment(statement) &&
                getAssignees(statement).some((it) => isSdsPlaceholder(it) && aggregator.referencedPlaceholders.has(it))
            ) {
                aggregator.addStatementWithoutPurity(statement);
            }
        }

        return aggregator.statements;
    }
    
    /**
     * Computes the subset of the given statements that are needed to calculate the target placeholder.
     */
    computeBackwardSliceOfPlaceholder(statements: SdsStatement[], target: SdsPlaceholder): SdsStatement[] {
        const parentStatement = target.$container as SdsStatement;
        
        return this.computeBackwardSliceToTargetsWithoutPurity(statements, [parentStatement]);
    }

    /**
     * Computes the forward slice from a variable.
     * Returns all data variables that are derived from the target.
     */
    computeForwardSliceFromVariable(target: SdsLocalVariable): SdsLocalVariable[] {
        const result = new Set<SdsLocalVariable>();
        this.accumulateVariablesInForwardSlice(target, result);
        return Array.from(result);
    }

    /**
     * Traverses the forward slice from 'start', accumulating all reached data variables
     * into 'resultAccumulator'. Delegates to 'collectReachedYields'; the yield return
     * value is discarded here since the top-level caller only needs the variables.
     */
    private accumulateVariablesInForwardSlice(
        startVariable: SdsLocalVariable,
        resultAccumulator: Set<SdsLocalVariable>,
    ): void {
        this.collectReachedYields(startVariable, resultAccumulator);
    }

    /**
     * Iterates over a growing worklist of references, starting from all uses of 'start'.
     * For each reference, 'handleReference' determines which downstream placeholders are reached. 
     * 'addReferencesToLHS' expands those into their own references and appends them to the worklist.
     *
     * Accumulates all reached data variables into 'resultAccumulator' as wanted a side effect.
     * Returns the yields reached during traversal so that 'getSegmentOutPlaceholders' can
     * map only those yields to call-site assignees (precise propagation through segments).
     *
     * 'visited' is per-invocation so the same segment entered from different call sites
     * always starts fresh — segment parameters are shared AST nodes across all call sites.
     *
     * Limitation: only direct variable references as segment arguments are followed
     * ('seg(data)' is followed, 'seg(transform(data))' is not).
     */
    private collectReachedYields(
        startVariable: SdsLocalVariable,
        resultAccumulator: Set<SdsLocalVariable>,
    ): Set<SdsYield> {
        if (!this.analyzer.isData(startVariable)) return new Set();

        // 'startVariable' itself is part of the slice
        resultAccumulator.add(startVariable);

        // Seed the worklist with 'startVariable' and initialize result
        const visited = new Set<SdsLocalVariable>([startVariable]);
        const reachedYields = new Set<SdsYield>();

        // Get the references of the start variable
        const references = this.nodeMapper.localVariableToReference(startVariable).toArray();

        // 'references' grows as we discover downstream placeholders. they are processed in-order.
        for (const ref of references) {
            // Determine which placeholders the value flows into at this reference site.
            const nextPlaceholders = this.handleReference(ref, startVariable, resultAccumulator, reachedYields);

            // Expand each new placeholder into its own references and append to the worklist.
            this.addReferencesToLHS(nextPlaceholders, references, visited, resultAccumulator);
        }

        return reachedYields;
    }

    /**
     * Handles a single reference to 'current' and returns the downstream placeholders
     * that the value flows into.
     *
     * The reference must appear on the RHS of an assignment. Depending on the RHS:
     * - Non-call or built-in function: all LHS placeholders are returned.
     * - Segment: only placeholders for yields actually reached from 'current' are returned 
     *   (see 'getSegmentOutPlaceholders').
     *
     * Any yield on the LHS is always recorded in 'reachedYields' so the caller knows
     * this variable flowed out of the segment through that yield.
     */
    private handleReference(
        reference: SdsReference,
        current: SdsLocalVariable,
        resultAccumulator: Set<SdsLocalVariable>,
        reachedYields: Set<SdsYield>,
    ): SdsLocalVariable[] {
        // References only matter when they appear on the RHS of an assignment.
        // That is where a variable's value flows into something new.
        const containingAssignment = AstUtils.getContainerOfType(reference, isSdsAssignment);
        if (!containingAssignment) return [];

        // get assignees (lhs) and expression (rhs)
        const lhs = getAssignees(containingAssignment);
        const rhs = containingAssignment.expression;

        // If any LHS slot is a yield, the value flows out of the enclosing segment through that yield.
        // Record it regardless of what the RHS looks like.
        for (const assignee of lhs) {
            if (isSdsYield(assignee)) reachedYields.add(assignee);
        }

        if (!rhs) return [];

        // No call: add all assignees
        if (!isSdsCall(rhs)) {
            // Plain renaming (e.g. 'val b = a'): all LHS placeholders depend on 'current'.
            return lhs.filter(isSdsPlaceholder);
        }

        // Call: Extract callable and differentiate between function and segment
        const callable = this.nodeMapper.callToCallable(rhs);
        if (isSdsFunction(callable)) {
            // Built-in function: all LHS placeholders are assumed to depend on 'current'.
            return lhs.filter(isSdsPlaceholder);
        }
        if (isSdsSegment(callable)) {
            // Segment: recurse to find exactly which yields are reached,
            // then return only the corresponding call-site placeholders.
            return this.getSegmentOutPlaceholders(current, containingAssignment, resultAccumulator, reachedYields);
        }

        return [];
    }

    /**
     * Expands each placeholder into its references and appends them to the worklist.
     * Skips already-visited placeholders (prevents infinite loops) and non-data variables.
     */
    private addReferencesToLHS(
        placeholders: SdsLocalVariable[],
        references: SdsReference[],
        visited: Set<SdsLocalVariable>,
        resultAccumulator: Set<SdsLocalVariable>,
    ): void {
        for (const placeholder of placeholders) {
            // Guard against revisiting and filter for only data placeholders
            if (visited.has(placeholder) || !this.analyzer.isData(placeholder)) continue;
            
            // add placeholder to visited and result
            visited.add(placeholder);
            resultAccumulator.add(placeholder);

            // Append this placeholder's own references to the end of the worklist.
            references.push(...this.nodeMapper.localVariableToReference(placeholder).toArray());
        }
    }

    /**
     * Recurses into a segment call for each parameter that receives 'current' as a direct argument. 
     * Returns only the call-site placeholders for yields actually reached from 'current'.
     *
     * If a call-site assignee is itself a yield (nested segment), it is recorded in 'reachedYields' 
     * and bubbled up to the caller instead.
     */
    private getSegmentOutPlaceholders(
        current: SdsLocalVariable,
        callSiteAssignment: SdsAssignment,
        resultAccumulator: Set<SdsLocalVariable>,
        reachedYields: Set<SdsYield>,
    ): SdsLocalVariable[] {
        // Extract information from call site assignment
        const callSiteAssignees = getAssignees(callSiteAssignment);
        const segmentCall = callSiteAssignment.expression;
        if (!isSdsCall(segmentCall)) return [];

        const segment = this.nodeMapper.callToCallable(segmentCall);
        if (!isSdsSegment(segment)) return [];

        // Map all parameters to their corresponding argument
        const paramArgMap = this.nodeMapper.callToParamArgMap(segmentCall);
        const outPlaceholders: SdsLocalVariable[] = [];

        for (const [param, arg] of paramArgMap) {
            // Skip the argument if it is not a direct reference to 'current'
            if (!isSdsReference(arg.value) || arg.value.target.ref !== current) continue;

            // Recurse into the segment from this parameter. A fresh 'visited' set is created inside,
            // so the same segment entered from a different call site is not incorrectly skipped.
            const segYields = this.collectReachedYields(param, resultAccumulator);
            
            // Iterate over the reached yields and map them to the corresponding assignee
            for (const yieldStmt of segYields) {
                const assignee = this.nodeMapper.yieldToCallSiteAssignee(yieldStmt, callSiteAssignees)
                // differentiate between placeholder (back to pipeline scope) and yield (nested segment)
                if (isSdsPlaceholder(assignee)) {
                    // Continue slice in the pipeline scope
                    outPlaceholders.push(assignee); 
                } else if (isSdsYield(assignee)) {
                    // Nested segment — bubble up to caller
                    reachedYields.add(assignee); 
                }
            }
        }
        return outPlaceholders;
    }
}




class BackwardSliceAggregator {
    private readonly purityComputer: SafeDsPurityComputer;

    /**
     * The statements that are needed to calculate the target statements.
     */
    readonly statements: SdsStatement[] = [];

    /**
     * The placeholders that are needed to calculate the target statements.
     */
    readonly referencedPlaceholders: Set<SdsPlaceholder>;

    /**
     * The impurity reasons of the collected statements.
     */
    readonly impurityReasons: ImpurityReason[] = [];

    constructor(purityComputer: SafeDsPurityComputer) {
        this.purityComputer = purityComputer;

        this.referencedPlaceholders = new Set();
    }

    addStatement(statement: SdsStatement): void {
        this.statements.unshift(statement);

        // Remember all referenced placeholders
        this.getReferencedPlaceholders(statement).forEach((it) => {
            this.referencedPlaceholders.add(it);
        });

        // Remember all impurity reasons
        this.purityComputer.getImpurityReasonsForStatement(statement).forEach((it) => {
            this.impurityReasons.push(it);
        });
    }

    addStatementWithoutPurity(statement: SdsStatement): void {
        this.statements.unshift(statement);

        // Remember all referenced placeholders
        this.getReferencedPlaceholders(statement).forEach((it) => {
            this.referencedPlaceholders.add(it);
        });
    }

    private getReferencedPlaceholders(node: SdsStatement): Stream<SdsPlaceholder> {
        return AstUtils.streamAllContents(node).flatMap((it) => {
            if (isSdsReference(it) && isSdsPlaceholder(it.target.ref)) {
                return [it.target.ref];
            } else {
                return [];
            }
        });
    }
}
