import { SafeDsServices } from '../safe-ds-module.js';
import { isSdsAssignment, isSdsPlaceholder, isSdsReference, isSdsMemberAccess,
        isSdsCall, isSdsFunction, isSdsDeclaration, isSdsChainedExpression, isSdsExpression, 
        SdsPlaceholder, SdsStatement, SdsCall } from '../generated/ast.js';
import { AstUtils, Stream } from 'langium';
import { ImpurityReason } from '../purity/model.js';
import { getAssignees } from '../helpers/nodeProperties.js';
import { SafeDsPurityComputer } from '../purity/safe-ds-purity-computer.js';
import { integer } from 'vscode-languageserver';
import { SafeDsNodeMapper } from '../helpers/safe-ds-node-mapper.js';
import { constraintListShouldNotBeEmpty } from '../validation/style.js';

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


    checkIfArgumentIsAssigneeOfSpecificFunction(
        placeholder: SdsPlaceholder, 
        functionCallName: string, 
        correctAssigneePosition: integer, 
        services: SafeDsServices, 
        placeholderBackwardSlice: SdsPlaceholder[] = []
    ) {
        const nodeMapper = services.helpers.NodeMapper;

        if (placeholderBackwardSlice.includes(placeholder)){
            return;
        }
        else { 
            placeholderBackwardSlice.push(placeholder); 
        }

        const parentAssigneeList = placeholder.$cstNode?.container?.astNode;
        const parentAssignment = parentAssigneeList?.$cstNode?.container?.astNode;

        if(!isSdsAssignment(parentAssignment)){ 
            return; 
        }
        
        const expr = parentAssignment.expression;
        if(!expr){ 
            return; 
        }
        
        if(isSdsCall(expr)){
            const callable = nodeMapper.callToCallable(expr);

            // Not the target call
            if (!isSdsFunction(callable) || callable.name != functionCallName){
                // Call recursively on all args
                this.checkCallArguments(
                    expr, functionCallName, 
                    correctAssigneePosition, services, 
                    placeholderBackwardSlice
                );
            }
            
            // Is the target call
            else if (isSdsFunction(callable) && callable.name == functionCallName){
                // Placeholder is at correct position -> can stop here
                if (parentAssignment.assigneeList?.assignees[correctAssigneePosition] === placeholder){
                    return;
                }
                // Placeholder is at wrong position -> need to go deeper
                else {
                    this.checkCallArguments(
                        expr, functionCallName, 
                        correctAssigneePosition, services, 
                        placeholderBackwardSlice
                    ); 
                    return;
                }
            }
            else {return;}
        }
        else {
            if(!isSdsReference(expr) || !isSdsDeclaration(expr.target) || !isSdsPlaceholder(expr.target.ref)){ 
                return; 
            }
            this.checkIfArgumentIsAssigneeOfSpecificFunction(
                expr.target.ref, 
                functionCallName, 
                correctAssigneePosition, 
                services, placeholderBackwardSlice
            );
            return;
        }
        return;
    }


    private checkCallArguments(
        call: SdsCall, 
        functionCallName: string, 
        correctAssigneePosition: integer, 
        services: SafeDsServices,
        placeholderBackwardSlice: SdsPlaceholder[] = []
    ) {
        if (!call) { return; }
        if (!isSdsExpression) { return; }
        
        // If this call is a chained member access, check its receiver for a placeholder
        if (isSdsChainedExpression(call) && isSdsMemberAccess(call.receiver)) {
            const receiverExpr = call.receiver.receiver;

            // Only proceed when the receiver is a reference to a placeholder declaration
            if (!isSdsReference(receiverExpr)) {
                // Nothing to do for non-reference receivers
            } 
            else {
                const referencedDecl = receiverExpr.target?.ref;
                if (isSdsPlaceholder(referencedDecl)) {
                    // Call top-level function for the referenced placeholder
                    this.checkIfArgumentIsAssigneeOfSpecificFunction(
                        referencedDecl,
                        functionCallName,
                        correctAssigneePosition,
                        services,
                        placeholderBackwardSlice
                    );
                }
            }
        }

        // Handle arguments
        const args = call.argumentList.arguments;
        if (!args) { 
            return; 
        }
        
        for (const arg of args){
            // Argument is a reference to a placeholder
            if (isSdsReference(arg.value)){
                const newHolder = arg.value.target.ref;
                if (!isSdsDeclaration(newHolder) || !isSdsPlaceholder(newHolder)) { 
                    continue; 
                }
                // Call top-level function for every argument that is reference to placeholder
                this.checkIfArgumentIsAssigneeOfSpecificFunction(
                    newHolder, 
                    functionCallName, 
                    correctAssigneePosition, 
                    services, placeholderBackwardSlice
                );
            }
            // Argument is a call
            else if (isSdsCall(arg.value)){
                const argRefCall = arg.value;
                // Call this function recursively for every argument that is a call
                this.checkCallArguments(
                    argRefCall, 
                    functionCallName, 
                    correctAssigneePosition, 
                    services, placeholderBackwardSlice
                );
            }
            else { 
                continue; 
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
