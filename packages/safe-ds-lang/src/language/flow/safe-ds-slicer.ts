import { SafeDsServices } from '../safe-ds-module.js';
import { isSdsAssignment, isSdsPlaceholder, isSdsReference, SdsPlaceholder, SdsStatement, isSdsCall, SdsReference, isSdsFunction, isSdsSegment, SdsLocalVariable } from '../generated/ast.js';
import { AstUtils, EMPTY_STREAM, Stream } from 'langium';
import { ImpurityReason } from '../purity/model.js';
import { getAssignees } from '../helpers/nodeProperties.js';
import { SafeDsPurityComputer } from '../purity/safe-ds-purity-computer.js';
import { SafeDsNodeMapper } from '../helpers/safe-ds-node-mapper.js';

export class SafeDsSlicer {
    private readonly purityComputer: SafeDsPurityComputer;
    private readonly nodeMapper: SafeDsNodeMapper;

    constructor(services: SafeDsServices) {
        this.purityComputer = services.purity.PurityComputer;
        this.nodeMapper = services.helpers.NodeMapper;
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

    computeForwardSliceFromVariable(target: SdsLocalVariable): Set<SdsLocalVariable> {
        const result : SdsReference[] = [];
        const workingStack : SdsLocalVariable[] = [target];
        const visited = new Set<SdsLocalVariable>();
        
        while (workingStack.length > 0) {
            const current = workingStack.pop();
            if (!current || visited.has(current)) continue;
            visited.add(current);

            const refs = this.nodeMapper.localVariableToReference(current).toArray();
            for (const ref of refs) {
                
                if (isSdsPlaceholder(ref.target.ref)) result.push(ref);

                // follow the reference to its containing assignment
                const containingAssignment = AstUtils.getContainerOfType(ref, isSdsAssignment)
                const assignees = containingAssignment?.assigneeList?.assignees;
                if (!assignees) continue;

                // differentiate between function and segment
                if (isSdsCall(containingAssignment?.expression)){
                    const callable = this.nodeMapper.callToCallable(containingAssignment?.expression)
                    
                    // case: function -> basic logic
                    if (isSdsFunction(callable)) {
                        // add all assignees to the working stack
                        for (const assignee of assignees) {
                            if (isSdsPlaceholder(assignee) && !visited.has(assignee)) {
                                workingStack.push(assignee);
                            }
                        }
                    }
                    // case: segment
                    else if (isSdsSegment(callable)) {
                        const matchingArg = containingAssignment.expression.argumentList.arguments
                            .find(arg => isSdsReference(arg.value) && arg.value.target.ref === current);
                        if (!matchingArg) continue;

                        const matchingParam = this.nodeMapper.argumentToParameter(matchingArg);
                        if (!matchingParam) continue;

                        workingStack.push(matchingParam);
                    }
                }
            }
        }
        return visited;
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
