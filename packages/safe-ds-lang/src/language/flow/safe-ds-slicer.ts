import { SafeDsServices } from '../safe-ds-module.js';
import { isSdsAssignment, isSdsPlaceholder, isSdsReference, isSdsCall, isSdsFunction, isSdsSegment, isSdsYield,
         SdsPlaceholder, SdsStatement, SdsLocalVariable, SdsYield, SdsCall, SdsAssignee, SdsSegment, SdsReference, 
         isSdsStatement} from '../generated/ast.js';
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
        this.forwardSliceInScope(target, result);
        return Array.from(result);
    }

    /**
     * Iterates over a growing worklist of references, starting from all uses of 'start'.
     * For each reference, 'handleReference' determines which downstream placeholders are
     * reached; 'addReferencesToLhs' expands those into their own references and appends
     * them to the worklist — mirroring the pseudocode structure exactly.
     *
     * Returns the yields reached during traversal so the caller can map only those to
     * call-site assignees (precise propagation through segment calls).
     *
     * 'visited' is per-invocation so the same segment entered from different call sites
     * always starts fresh — segment parameters are shared AST nodes across all call sites.
     *
     * Limitation: only direct variable references as segment arguments are followed
     * ('seg(data)' is followed, 'seg(transform(data))' is not).
     */
    private forwardSliceInScope(
        start: SdsLocalVariable,
        result: Set<SdsLocalVariable>,
    ): Set<SdsYield> {
        if (!this.analyzer.isData(start)) return new Set();

        // 'start' itself is part of the slice; seed the worklist with its references.
        result.add(start);
        const visited = new Set<SdsLocalVariable>([start]);
        const reachedYields = new Set<SdsYield>();
        const references = this.nodeMapper.localVariableToReference(start).toArray();

        // 'references' grows as we discover downstream placeholders — processed in-order.
        for (const ref of references) {
            // Determine which placeholders the value flows into at this reference site.
            const nextPlaceholders = this.handleReference(ref, start, result, reachedYields);
            // Expand each new placeholder into its own references and append to the worklist.
            this.addReferencesToLhs(nextPlaceholders, references, visited, result);
        }

        return reachedYields;
    }

    /**
     * Handles a single reference to 'current' and returns the downstream placeholders
     * that the value flows into.
     *
     * The reference must appear on the RHS of an assignment. Depending on the RHS:
     * - Non-call or built-in function: all LHS placeholders are returned.
     * - User-defined segment: only placeholders for yields actually reached from
     *   'current' are returned (see 'getSegmentOutPlaceholders').
     * - Other callables (classes, lambdas): nothing returned.
     *
     * Any yield on the LHS is always recorded in 'reachedYields' so the caller knows
     * this variable flowed out of the segment through that yield.
     */
    private handleReference(
        ref: SdsReference,
        current: SdsLocalVariable,
        result: Set<SdsLocalVariable>,
        reachedYields: Set<SdsYield>,
    ): SdsLocalVariable[] {
        // References only matter when they appear on the RHS of an assignment —
        // that is where a variable's value flows into something new.
        const assignment = AstUtils.getContainerOfType(ref, isSdsAssignment);
        if (!assignment) return [];

        const lhs = getAssignees(assignment);
        const rhs = assignment.expression;

        // If any LHS slot is a yield, the value flows out of the enclosing segment
        // through that yield. Record it regardless of what the RHS looks like.
        for (const assignee of lhs) {
            if (isSdsYield(assignee)) reachedYields.add(assignee);
        }

        if (!rhs) return [];

        if (!isSdsCall(rhs)) {
            // Plain assignment (e.g. 'val b = a'): all LHS placeholders depend on 'current'.
            return lhs.filter(isSdsPlaceholder);
        }

        const callable = this.nodeMapper.callToCallable(rhs);

        if (isSdsFunction(callable)) {
            // Built-in function: body is opaque, so conservatively all LHS placeholders
            // are assumed to depend on 'current'.
            return lhs.filter(isSdsPlaceholder);
        }

        if (isSdsSegment(callable)) {
            // User-defined segment: recurse to find exactly which yields are reached,
            // then return only the corresponding call-site placeholders.
            return this.getSegmentOutPlaceholders(current, rhs, callable, lhs, result, reachedYields);
        }

        return [];
    }

    /**
     * Expands each placeholder into its references and appends them to the worklist.
     * Skips already-visited placeholders (prevents infinite loops) and non-data variables.
     */
    private addReferencesToLhs(
        placeholders: SdsLocalVariable[],
        references: SdsReference[],
        visited: Set<SdsLocalVariable>,
        result: Set<SdsLocalVariable>,
    ): void {
        for (const placeholder of placeholders) {
            // Guard against revisiting (cycles / diamond-shaped data flows).
            if (visited.has(placeholder) || !this.analyzer.isData(placeholder)) continue;
            visited.add(placeholder);
            result.add(placeholder);
            // Append this placeholder's own references to the end of the worklist.
            references.push(...this.nodeMapper.localVariableToReference(placeholder).toArray());
        }
    }

    /**
     * Recurses into a segment call for each parameter that receives 'current' as a direct
     * argument. Returns only the call-site placeholders for yields actually reached from
     * 'current' — not all LHS slots (precise propagation, fixes the pseudocode issue).
     *
     * If a call-site assignee is itself a yield (nested segment), it is recorded in
     * 'reachedYields' and bubbled up to the caller instead.
     */
    private getSegmentOutPlaceholders(
        current: SdsLocalVariable,
        call: SdsCall,
        segment: SdsSegment,
        callSiteAssignees: SdsAssignee[],
        result: Set<SdsLocalVariable>,
        reachedYields: Set<SdsYield>,
    ): SdsLocalVariable[] {
        const paramArgMap = this.nodeMapper.callToParamArgMap(call);
        const outPlaceholders: SdsLocalVariable[] = [];

        for (const [param, argExpr] of paramArgMap) {
            // Only follow the argument if it is a direct reference to `current`.
            // Wrapped expressions like `seg(transform(data))` are not tracked.
            if (!isSdsReference(argExpr) || argExpr.target.ref !== current) continue;

            // Recurse into the segment from this parameter. A fresh `visited` set is
            // created inside, so the same segment entered from a different call site
            // is not incorrectly skipped.
            const segYields = this.forwardSliceInScope(param, result);

            // Map only the yields that were actually reached back to call-site positions.
            for (const { yieldStmt, assignee } of this.nodeMapper.segmentYieldsWithAssignees(segment, callSiteAssignees)) {
                if (!segYields.has(yieldStmt)) continue; // yield not reached from `current`
                if (isSdsPlaceholder(assignee)) {
                    outPlaceholders.push(assignee); // continue slice in the outer scope
                } else if (isSdsYield(assignee)) {
                    reachedYields.add(assignee); // nested segment — bubble up to caller
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
