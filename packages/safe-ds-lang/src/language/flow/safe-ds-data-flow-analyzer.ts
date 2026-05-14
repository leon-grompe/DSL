import { SafeDsServices } from '../safe-ds-module.js';
import { isSdsAssignment, isSdsPlaceholder, isSdsReference, isSdsMemberAccess,
         isSdsCall, isSdsFunction, isSdsDeclaration, isSdsChainedExpression, 
         SdsPlaceholder, SdsCall, SdsChainedExpression} from '../generated/ast.js';
import { ClassType, NamedType } from '../typing/model.js';
import { any } from 'true-myth/task';

export class SafeDsDataFlowAnalyzer {
    constructor(services: SafeDsServices) {}

    /**
     * Computes whether the given placeholder is an assignee argument at a specific position of a specific function call.
     * Stops as soon as first match is found.
     * @param placeholder The placeholder to check.
     * @param functionCallName The name of the function call.
     * @param correctAssigneePosition The position the placeholder should be at.
     * @param services SafeDs services to access helpers.
     * @param placeholderBackwardSlice If an Array is provided it will collect all Placeholders relevant for the value of the given Placeholder.
     * @returns Returns true, if the placeholder is assignee of specific function at a specific assignee position. False otherwise.
     */
    checkIfArgumentIsAssigneeOfSpecificFunction(
        placeholder: SdsPlaceholder, 
        functionCallName: string, 
        correctAssigneePosition: number, 
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
        if (this.checkIfArgumentIsAssigneeOfSpecificFunction(
            expr.target.ref, functionCallName, 
            correctAssigneePosition, services, 
            placeholderBackwardSlice
        )) {
            return true;
        }
        return false;        
    }

    /**
     * Helper to check all arguments of a call for a placeholder being an assignee of a specific function.
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
        correctAssigneePosition: number, 
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
                call, functionCallName,
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
                    if (this.checkIfArgumentIsAssigneeOfSpecificFunction(
                        newHolder, functionCallName, 
                        correctAssigneePosition, services, 
                        placeholderBackwardSlice
                    )) {
                    return true;
                    }
                }
            }
            // Argument is a call
            else if (isSdsCall(arg.value)) {
                if (this.checkCallArguments(
                    arg.value, functionCallName, 
                    correctAssigneePosition, services, 
                    placeholderBackwardSlice
                )) {
                    return true;
                }
            }
            // Member access?
            // Chained expression?
        }
        return false;
    }

    /**
     * Helper to handle nested chained expressions when checking for placeholders.
     * @param chainedExpr The chained expression to check.
     * @param functionCallName The name of the function call. Same as in checkIfArgumentIsAssigneeOfSpecificFunction.
     * @param correctAssigneePosition The position the placeholder should be at. Same as in checkIfArgumentIsAssigneeOfSpecificFunction.
     * @param services SafeDs services to access helpers.
     * @param placeholderBackwardSlice Array to collect the Placeholders in the backward slice of the given Placeholder. 
     *                                 Same as in checkIfArgumentIsAssigneeOfSpecificFunction.
     * @returns True if checkIfArgumentIsAssigneeOfSpecificFunction returned true for the receiver placeholder, false otherwise.
     */
    private handleChainedExpression(
        chainedExpr: SdsChainedExpression, 
        functionCallName: string, 
        correctAssigneePosition: number, 
        services: SafeDsServices,
        placeholderBackwardSlice: SdsPlaceholder[] = []
    ): boolean {
        // Direct reference to a receiver
        if (isSdsReference(chainedExpr.receiver)) {
            const referencedDecl = chainedExpr.receiver.target.ref;
            if (isSdsPlaceholder(referencedDecl)) {
                if (this.checkIfArgumentIsAssigneeOfSpecificFunction(
                    referencedDecl, functionCallName,
                    correctAssigneePosition, services,
                    placeholderBackwardSlice
                )) {
                    return true;
                }
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
                        referencedDecl, functionCallName,
                        correctAssigneePosition, services,
                        placeholderBackwardSlice
                    )) {
                        return true;
                    }
                }
            }
        }

        // If the receiver is another chained expression, handle it recursively
        if (isSdsChainedExpression(chainedExpr.receiver)) {
            if (this.handleChainedExpression(
                chainedExpr.receiver, functionCallName,
                correctAssigneePosition, services,
                placeholderBackwardSlice
            )) {
                return true;
            }
        }
        return false;
    }

    checkCallTargets(
        call: SdsCall,
        functionCallName: string,
        correctAssigneePosition: number,
        services: SafeDsServices
    ): boolean {
        const candidates = this.extractPlaceholderCandidates(call);

        return (candidates.some(placeholder =>
            this.checkIfArgumentIsAssigneeOfSpecificFunction(
                placeholder, functionCallName,
                correctAssigneePosition,
                services
            )
        ))
    }

    // PROBLEM: nicht jedes argument ist direkt candidate, könnte auch geschachtelt sein
    private extractPlaceholderCandidates(call: SdsCall): SdsPlaceholder[] {
        const candidates: SdsPlaceholder[] = [];

        // case: receiver
        const receiver = call.receiver;
        if (isSdsMemberAccess(receiver) && isSdsReference(receiver.receiver)) {
            const decl = receiver.receiver.target?.ref;
            if (isSdsPlaceholder(decl)) {
                candidates.push(decl);
            }
        } 
        else if (isSdsReference(receiver)) {
            const decl = receiver.target?.ref;
            if (isSdsPlaceholder(decl)) {
                candidates.push(decl);
            }
        }

        // case: argument
        for (const arg of call.argumentList?.arguments ?? []) {
            if (isSdsReference(arg.value)) {
                const decl = arg.value.target?.ref;
                if (isSdsPlaceholder(decl)) {
                    candidates.push(decl);
                }
            }
        }

        return candidates;            
    }

    callReferencesTrainingSet(call: SdsCall, services: SafeDsServices): boolean {
        const typeComputer = services.typing.TypeComputer; 
        const coreTypes = services.typing.CoreTypes;
        const builtinClasses = services.builtins.Classes;
        
        const candidates = this.extractPlaceholderCandidates(call);
        for (const placeholder of candidates) {
            const type = typeComputer.computeType(placeholder);

            // Check for core type: Table
            if (type instanceof NamedType && (
                type.declaration.name === 'Table' ||
                type.declaration.name === 'TabularDataset')
            ) {
                console.log("Found Type: " + type + " for placeholder: " + placeholder.name)
            } else {
                console.log("Found Type: " + type + " for placeholder: " + placeholder.name + " which is not a Table or TabularDataset")
            }

        }
        return false;
    }

    callReferencesValidationSet(){

    }

    callReferencesTestSet(){
        
    }
}