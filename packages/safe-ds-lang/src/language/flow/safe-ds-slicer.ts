import { SafeDsServices } from '../safe-ds-module.js';
import { isSdsAssignment, isSdsPlaceholder, isSdsReference, isSdsMemberAccess,
        isSdsCall, isSdsFunction, isSdsDeclaration, isSdsChainedExpression, isSdsExpression, 
        SdsPlaceholder, SdsStatement, SdsCall, SdsAssignment, 
        SdsChainedExpression} from '../generated/ast.js';
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
     * Computes whether the given placeholder is an assignee argument at a specific position of a specific function call.
     * Stops as soon as first match is found.
     * @param placeholder The placeholder to check.
     * @param functionCallName The name of the function call.
     * @param correctAssigneePosition The position the placeholder should be at.
     * @param services SafeDs services to access helpers.
     * @param placeholderBackwardSlice If an Array is provided it will collect all Placeholders relevant for the value of the given Placeholder.
     * @returns A tuple where the first element is true if the placeholder is an assignee argument at the specified position
     *          of the function call, and the second element is the placeholder for which it evaluated true (or null).
     */
    checkIfArgumentIsAssigneeOfSpecificFunction(
        placeholder: SdsPlaceholder, 
        functionCallName: string, 
        correctAssigneePosition: integer, 
        services: SafeDsServices, 
        placeholderBackwardSlice: SdsPlaceholder[] = []
    ): boolean
    {     
        const parentAssignment = placeholder.$container?.$container;

        if (!isSdsAssignment(parentAssignment)) { 
            return false; 
        }

        // Skip placeholders of statement if already visited
        if (placeholderBackwardSlice.includes(placeholder)) {
            return false;
        }
        // Remember visited placeholders of statement
        placeholderBackwardSlice.push(placeholder);
        
        const expr = parentAssignment.expression;
        if (!expr) { 
            return false; 
        }
        
        if (isSdsCall(expr)) {
            const callable = services.helpers.NodeMapper.callToCallable(expr);

            // Not the target call -> check all arguments recursively
            if (!isSdsFunction(callable) || callable.name !== functionCallName) {
                return this.checkCallArguments(
                    expr, functionCallName, 
                    correctAssigneePosition, services, 
                    placeholderBackwardSlice
                );
            }
            
            // Is the target call -> check if placeholder is at correct position
            if (parentAssignment.assigneeList?.assignees[correctAssigneePosition] === placeholder) {
                // Placeholder is at correct position -> return true
                return true;
            }
            else {
                // Placeholder is at wrong position -> check arguments for deeper matches
                return this.checkCallArguments(
                    expr, functionCallName, 
                    correctAssigneePosition, services, 
                    placeholderBackwardSlice
                );
            }
        }
        
        // Expression is a reference to another placeholder
        if (!isSdsReference(expr) || !isSdsDeclaration(expr.target) || !isSdsPlaceholder(expr.target.ref)) { 
            return false; 
        }
        // MAYBE NEED TO CHECK FOR OTHER TYPES
        // e.g. SdsList COULD CONTAIN NON PRIMITIVE TYPES
        
        // Recursive call for the referenced placeholder
        return this.checkIfArgumentIsAssigneeOfSpecificFunction(
            expr.target.ref, 
            functionCallName, 
            correctAssigneePosition, 
            services, 
            placeholderBackwardSlice
        );
    }

    /**
     * Helpers to check all arguments of a call for a placeholder being an assignee of a specific function.
     * @param call The call to check.
     * @param functionCallName The name of the function call. Same as in checkIfArgumentIsAssigneeOfSpecificFunction.
     * @param correctAssigneePosition The position the placeholder should be at. Same as in checkIfArgumentIsAssigneeOfSpecificFunction.
     * @param services SafeDs services to access helpers.
     * @param placeholderBackwardSlice  Array to collect the Placeholders in the backward slice of the given Placeholder. 
     *                                  Same as in checkIfArgumentIsAssigneeOfSpecificFunction.
     * @returns True if checkIfArgumentIsAssigneeOfSpecificFunction returned true for any argument, false otherwise.
     */
    private checkCallArguments(
        call: SdsCall, 
        functionCallName: string, 
        correctAssigneePosition: integer, 
        services: SafeDsServices,
        placeholderBackwardSlice: SdsPlaceholder[] = []
    ): boolean 
    {
        if (!call) { 
            return false; 
        }
        
        // If call is chained member access, check its receiver for a placeholder
        if (isSdsChainedExpression(call)) {
            if (this.handleChainedExpression(
                call,
                functionCallName,
                correctAssigneePosition,
                services,
                placeholderBackwardSlice
            )) {
                return true;
            }
        }

        // Handle all actual arguments
        const args = call.argumentList?.arguments;
        if (!args) { 
            return false; 
        }
        
        for (const arg of args) {
            // Argument is a reference to a placeholder
            if (isSdsReference(arg.value)) {
                const newHolder = arg.value.target.ref;
                if (isSdsDeclaration(newHolder) && isSdsPlaceholder(newHolder)) {
                    return this.checkIfArgumentIsAssigneeOfSpecificFunction(
                        newHolder, 
                        functionCallName, 
                        correctAssigneePosition, 
                        services, 
                        placeholderBackwardSlice
                    );
                }
            }
            // Argument is a call
            else if (isSdsCall(arg.value)) {
                    if (this.checkCallArguments(
                        arg.value, 
                        functionCallName, 
                        correctAssigneePosition, 
                        services, 
                        placeholderBackwardSlice
                    )) {
                        return true;
                    }
            }
        }
            return false;
    }

    private handleChainedExpression(
        chainedExpr: SdsChainedExpression, 
        functionCallName: string, 
        correctAssigneePosition: integer, 
        services: SafeDsServices,
        placeholderBackwardSlice: SdsPlaceholder[] = []
    ): boolean {
        // If the receiver is another chained expression, handle it recursively
        if (isSdsChainedExpression(chainedExpr.receiver)) {
            if (this.handleChainedExpression(
                chainedExpr.receiver,
                functionCallName,
                correctAssigneePosition,
                services,
                placeholderBackwardSlice
            )) {
                return true;
            }
        }

        // If the receiver is a member access, check its receiver for a placeholder
        if (isSdsMemberAccess(chainedExpr.receiver)) {
            const receiverExpr = chainedExpr.receiver.receiver;
            if (isSdsReference(receiverExpr)) {
                const referencedDecl = receiverExpr.target?.ref;
                if (isSdsPlaceholder(referencedDecl)) {
                    // Check if receiver placeholder matches the condition
                    if (this.checkIfArgumentIsAssigneeOfSpecificFunction(
                        referencedDecl,
                        functionCallName,
                        correctAssigneePosition,
                        services,
                        placeholderBackwardSlice
                    )) {
                        return true;
                    }
                }
            }
        }
        return false;
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
