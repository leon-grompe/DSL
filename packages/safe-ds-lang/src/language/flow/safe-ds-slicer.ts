import { SafeDsServices } from '../safe-ds-module.js';
import { isSdsAssignment, isSdsPlaceholder, isSdsReference, SdsPlaceholder, SdsStatement, SdsArgument, SdsReference, isSdsCall, isSdsFunction } from '../generated/ast.js';
import { AstUtils, Stream } from 'langium';
import { ImpurityReason } from '../purity/model.js';
import { getAssignees } from '../helpers/nodeProperties.js';
import { SafeDsPurityComputer } from '../purity/safe-ds-purity-computer.js';
import { integer } from 'vscode-languageserver';
import { SafeDsNodeMapper } from '../helpers/safe-ds-node-mapper.js';

export class SafeDsSlicer {
    private readonly purityComputer: SafeDsPurityComputer;

    constructor(services: SafeDsServices) {
        this.purityComputer = services.purity.PurityComputer;
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


    checkIfArgumentIsAssigneeOfSpecificFunction(services: SafeDsServices, placeholderRef: SdsReference, functionCallName: String, correctAssigneePosition: integer) {
        const nodeMapper = services.helpers.NodeMapper;
        
        const referencedPlaceholder = placeholderRef.target.ref as SdsPlaceholder;
        const parent = referencedPlaceholder.$cstNode?.container?.astNode;
        if(!isSdsAssignment(parent)){
            return;
        }
        
        const expr = parent.expression;
        if(!expr){
            return;
        }
        if(isSdsCall(expr)){
            const callable = nodeMapper.callToCallable(expr);
            const args = expr.argumentList.arguments;
            
            // Not the target call
            if (!isSdsFunction(callable) || callable.name != functionCallName){
                // Call recursively on all args
                for (const arg of args){
                    if (isSdsReference(arg.value)){
                        const argRef = arg.value;
                        this.checkIfArgumentIsAssigneeOfSpecificFunction(services, argRef, functionCallName, correctAssigneePosition);
                    }
                    else { return; }
                }
            }
            
            // Is the target call
            else {
                // Placeholder is at correct position -> need to go deeper
                if (parent.assigneeList?.assignees[correctAssigneePosition] === referencedPlaceholder){
                    for (const arg of args){
                        // Argument is a reference to a placeholder
                        if (isSdsReference(arg.value)){
                            const argRefPlchldr = arg.value;
                            this.checkIfArgumentIsAssigneeOfSpecificFunction(services, argRefPlchldr, functionCallName, correctAssigneePosition);
                        }
                        // Argument is a call
                        else if (isSdsCall(arg.value)){
                            const argRefCll = arg.value;
                            const newArgs = argRefCll.argumentList.arguments;
                            for (const newArg of newArgs){
                                const newRef = newArg.value as SdsReference;
                                this.checkIfArgumentIsAssigneeOfSpecificFunction(services, newRef, functionCallName, correctAssigneePosition)
                            }
                        }
                    }
                }
                // Placeholder is at 
                else {
                    return;
                }

            }
        }
        else {
            if(!isSdsReference(expr)){
                return;
            }
            this.checkIfArgumentIsAssigneeOfSpecificFunction(services, expr, functionCallName, correctAssigneePosition);
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
