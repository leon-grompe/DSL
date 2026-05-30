import { SafeDsServices } from '../safe-ds-module.js';
import { isSdsAssignment, isSdsPlaceholder, isSdsReference, isSdsCall, isSdsFunction, isSdsSegment, isSdsYield,
         SdsPlaceholder, SdsStatement, SdsLocalVariable, SdsYield, SdsCall, SdsAssignee, SdsSegment } from '../generated/ast.js';
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
     * Worklist-based forward traversal starting from `start`.
     *
     * All data variables that `start` flows into are added to `result` (shared across all
     * recursive calls so the final accumulation is in one place).
     *
     * Returns the set of yields that were reached during this traversal. The caller uses
     * this to decide which call-site assignees to continue propagating into — only those
     * that correspond to a reached yield, not all of them.
     *
     * `visited` is per-invocation (not shared) so that the same segment can be entered
     * independently from different call sites. Segment parameters are single AST nodes
     * shared across all call sites; a global visited set would cause the second call site
     * to skip a parameter it had already processed for the first.
     *
     * Limitation: only direct variable references as arguments are followed into segments
     * (e.g. `seg(data)` is followed, `seg(transform(data))` is not).
     */
    private forwardSliceInScope(
        start: SdsLocalVariable,
        result: Set<SdsLocalVariable>,
    ): Set<SdsYield> {
        const worklist: SdsLocalVariable[] = [start];
        const visited = new Set<SdsLocalVariable>();
        const reachedYields = new Set<SdsYield>();

        while (worklist.length > 0) {
            const current = worklist.pop()!;
            if (visited.has(current)) continue;
            // Only track data-typed variables (Image, Table, Dataset, etc.)
            if (!this.analyzer.isData(current)) continue;

            visited.add(current);
            result.add(current);

            // Find every place in the code where `current` is referenced.
            for (const ref of this.nodeMapper.localVariableToReference(current).toArray()) {
                // We only care about references that appear on the RHS of an assignment,
                // because those are the only places where a variable's value flows somewhere.
                const assignment = AstUtils.getContainerOfType(ref, isSdsAssignment);
                if (!assignment) continue;

                const lhs = getAssignees(assignment);
                const rhs = assignment.expression;

                // If any LHS slot is a yield, this variable has flowed out of the segment
                // through that yield — record it so the caller can propagate past the call site.
                // This is independent of what the RHS looks like.
                for (const assignee of lhs) {
                    if (isSdsYield(assignee)) reachedYields.add(assignee);
                }

                if (!rhs) continue;

                const callable = isSdsCall(rhs) ? this.nodeMapper.callToCallable(rhs) : undefined;

                if (!isSdsCall(rhs) || isSdsFunction(callable)) {
                    // Either not a call (e.g. a plain reference `b = a`) or a built-in function
                    // whose body we cannot inspect. In both cases, conservatively assume all
                    // LHS placeholders depend on this variable.
                    for (const assignee of lhs) {
                        if (isSdsPlaceholder(assignee)) worklist.push(assignee);
                    }
                } else if (isSdsSegment(callable)) {
                    // User-defined segment: recurse into it to get precise yield information,
                    // then map only the yields that were actually reached to call-site assignees.
                    this.propagateThroughSegment(current, rhs, callable, lhs, worklist, result, reachedYields);
                }
                // Other callables (classes, lambdas, …) are ignored — no propagation.
            }
        }

        return reachedYields;
    }

    /**
     * Enters a segment call on behalf of `current` and propagates the slice through it.
     *
     * For each parameter that receives `current` as a direct argument, we recurse into the
     * segment. The recursion returns which of the segment's yields were reached. We then
     * look up which call-site assignees correspond to those yields and add only those to the
     * worklist — avoiding false propagation through yields that `current` never flows into.
     *
     * If a call-site assignee is itself a yield (nested segment call), we bubble it up to
     * the caller's `reachedYields` set rather than pushing it onto the worklist.
     */
    private propagateThroughSegment(
        current: SdsLocalVariable,
        call: SdsCall,
        segment: SdsSegment,
        callSiteAssignees: SdsAssignee[],
        worklist: SdsLocalVariable[],
        result: Set<SdsLocalVariable>,
        reachedYields: Set<SdsYield>,
    ): void {
        const paramArgMap = this.nodeMapper.callToParamArgMap(call);

        for (const [param, argExpr] of paramArgMap) {
            // Only follow the argument that is a direct reference to `current`.
            // Expressions like `f(data)` as an argument are not tracked.
            if (!isSdsReference(argExpr) || argExpr.target.ref !== current) continue;

            // Recurse into the segment body starting from this parameter.
            // A fresh `visited` set is created inside, so the same segment traversed
            // from a different call site starts clean.
            const segYields = this.forwardSliceInScope(param, result);

            // Map the reached yields to their corresponding call-site positions.
            for (const { yieldStmt, assignee } of this.nodeMapper.segmentYieldsWithAssignees(segment, callSiteAssignees)) {
                if (!segYields.has(yieldStmt)) continue; // this yield was not reached from `current`
                if (isSdsPlaceholder(assignee)) {
                    worklist.push(assignee); // continue the slice in the outer scope
                } else if (isSdsYield(assignee)) {
                    reachedYields.add(assignee); // nested: result feeds an outer segment yield
                }
            }
        }
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
