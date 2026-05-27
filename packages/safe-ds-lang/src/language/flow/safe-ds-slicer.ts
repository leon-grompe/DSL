import { SafeDsServices } from '../safe-ds-module.js';
import { isSdsAssignment, isSdsPlaceholder, isSdsReference, isSdsCall, isSdsFunction, isSdsSegment, isSdsYield,
         SdsPlaceholder, SdsStatement, SdsAssignee, SdsLocalVariable, SdsSegment, SdsCall } from '../generated/ast.js';
import { AstUtils, Stream } from 'langium';
import { ImpurityReason } from '../purity/model.js';
import { getAssignees } from '../helpers/nodeProperties.js';
import { SafeDsPurityComputer } from '../purity/safe-ds-purity-computer.js';
import { SafeDsNodeMapper } from '../helpers/safe-ds-node-mapper.js';
import { result } from 'true-myth';
import { isDataView } from 'util/types';
import { SafeDsDataFlowAnalyzer } from './safe-ds-data-flow-analyzer.js';
import { vi } from 'vitest';

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
     * The result contains all variables that are derived from the target and are data.
     */
    computeForwardSliceFromVariable(target: SdsLocalVariable): SdsLocalVariable[] {
        const workingStack : SdsLocalVariable[] = [target];
        const visited = new Set<SdsLocalVariable>;
        
        while (workingStack.length > 0) {
            const currentVariable = workingStack.pop();
            if (!currentVariable || visited.has(currentVariable)) continue;
            // skip non-data variables
            if (!this.analyzer.isData(currentVariable)) continue;
            
            // add the current variable to visited and therefore to the result
            visited.add(currentVariable);

            // get all references of the current variable
            const refs = this.nodeMapper.localVariableToReference(currentVariable).toArray();
            for (const ref of refs) {

                // follow the reference to its containing assignment
                const containingAssignment = AstUtils.getContainerOfType(ref, isSdsAssignment)
                const assignees = containingAssignment?.assigneeList?.assignees;
                if (!assignees) continue;

                // differentiate between function and segment
                if (isSdsCall(containingAssignment?.expression)){
                    const callable = this.nodeMapper.callToCallable(containingAssignment?.expression)
                    
                    // case: function -> basic logic
                    if (isSdsFunction(callable)) {
                        this.handleFunction(assignees, workingStack, visited);
                    }
                    // case: segment -> more complex logic
                    else if (isSdsSegment(callable)) {
                        this.handleSegment(callable, assignees, currentVariable, containingAssignment.expression, workingStack, visited);
                    }
                }
            }
        }
        return Array.from(visited);
    }

    /**
     * Propagates the forward slice through a function call.
     * @param assignees The assignees of the containing assignment.
     * @param workingStack The current working stack which is being filled by this function.
     * @param visited The already visited variables which are being updated by this function.
     */
    private handleFunction(
        assignees: SdsAssignee[],
        workingStack: SdsLocalVariable[],
        visited: Set<SdsLocalVariable>
    ): void {
        // add unvisited assignees to the stack
        for (const assignee of assignees) {
            if (isSdsPlaceholder(assignee) && !visited.has(assignee)) {
                // Continue forward slicing from this assignee
                workingStack.push(assignee);
            }
        }
    }

    /**
     * Propagates the forward slice through a segment call.
     * @param callable The segment being called
     * @param assignees The assignees of the containing assignment at the call site.
     * @param currentVariable The variable currently being sliced.
     * @param expression The call expression (right side of the assignment).
     * @param workingStack The current working stack which is being filled by this function.
     * @param visited The already visited variables which are being updated by this function.
     */
    private handleSegment(
        callable: SdsSegment,
        assignees: SdsAssignee[],
        currentVariable: SdsLocalVariable,
        expression: SdsCall,
        workingStack: SdsLocalVariable[],
        visited: Set<SdsLocalVariable>
    ): void {
        // Find the argument that references the current variable
        const matchingArg = expression.argumentList.arguments.find(arg => 
            isSdsReference(arg.value) 
            && arg.value.target.ref === currentVariable);
        if (!matchingArg) return;

        // Map the argument to its corresponding parameter inside the segment
        const matchingParam = this.nodeMapper.argumentToParameter(matchingArg);
        if (!matchingParam) return;
        
        // Continue the forward slice from the parameter inside the segment body
        workingStack.push(matchingParam);

        // Map yields back to assigness at the call site
        // The yield corresponds to the result of the segment which corresponds to the assignee at the call site
        const yields = AstUtils.streamAllContents(callable).filter(isSdsYield).toArray();
        for (const yieldStmnt of yields) {
            // Find the position of this yield's result in the segment's result list
            const resultIndex = callable.resultList?.results
                .findIndex(r => r === yieldStmnt.result?.ref);
            if (resultIndex === undefined || resultIndex < 0) continue;

            // The assignee at the same position at the call site receives the result
            const matchingAssignee = assignees[resultIndex];
            if (isSdsPlaceholder(matchingAssignee) && !visited.has(matchingAssignee)) {
                // Continue the forward slice from the assignee that has been assigned this result
                workingStack.push(matchingAssignee);
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
