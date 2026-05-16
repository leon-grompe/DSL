import { SafeDsServices } from '../safe-ds-module.js';
import { AstUtils } from 'langium';
import { isSdsAssignment, isSdsPlaceholder, isSdsReference, isSdsMemberAccess,
         isSdsCall, isSdsFunction, isSdsDeclaration, isSdsChainedExpression, 
         SdsPlaceholder, SdsCall, SdsChainedExpression} from '../generated/ast.js';
import { ClassType } from '../typing/model.js';

export class SafeDsDataFlowAnalyzer {
    constructor(
        private services: SafeDsServices
    ) {}

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
            const callable = this.services.helpers.NodeMapper.callToCallable(expr);

            // Not the target call -> check all arguments recursively
            if (!isSdsFunction(callable) || callable.name !== functionCallName) {
                return this.checkCallArguments(
                    expr, functionCallName, 
                    correctAssigneePosition, 
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
                    correctAssigneePosition, 
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
            correctAssigneePosition, 
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
                        correctAssigneePosition, 
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
                    correctAssigneePosition, 
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
        placeholderBackwardSlice: SdsPlaceholder[] = []
    ): boolean {
        // Direct reference to a receiver
        if (isSdsReference(chainedExpr.receiver)) {
            const referencedDecl = chainedExpr.receiver.target.ref;
            if (isSdsPlaceholder(referencedDecl)) {
                if (this.checkIfArgumentIsAssigneeOfSpecificFunction(
                    referencedDecl, functionCallName,
                    correctAssigneePosition,
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
                        correctAssigneePosition,
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
                correctAssigneePosition,
                placeholderBackwardSlice
            )) {
                return true;
            }
        }
        return false;
    }


    checkIfPlaceholderIsAssigneeOfSpecificFunction(
        placeholder: SdsPlaceholder,
        functionCallName: string,
        correctAssigneePosition: number,
        placeholderBackwardSlice: SdsPlaceholder[] = []
    ): boolean {
        const parentAssignment = AstUtils.getContainerOfType(placeholder, isSdsAssignment);

        if (!parentAssignment) {
            return false;
        }

        if (placeholderBackwardSlice.includes(placeholder)) {
            return false;
        }
        placeholderBackwardSlice.push(placeholder);

        const expr = parentAssignment.expression;
        if (!expr) {
            return false;
        }

        if (isSdsCall(expr)) {
            const callable = this.services.helpers.NodeMapper.callToCallable(expr);
            if (
                isSdsFunction(callable) &&
                callable.name === functionCallName &&
                parentAssignment.assigneeList?.assignees[correctAssigneePosition] === placeholder
            ) {
                return true;
            }

            const referencedPlaceholders = this.extractOnlyDataPlaceholders(expr);
            for (const referencedPlaceholder of referencedPlaceholders) {
                if (this.checkIfPlaceholderIsAssigneeOfSpecificFunction(
                    referencedPlaceholder,
                    functionCallName,
                    correctAssigneePosition,
                    placeholderBackwardSlice
                )) {
                    return true;
                }
            }
            return false;
        }

        if (isSdsReference(expr) && isSdsPlaceholder(expr.target.ref)) {
            return this.checkIfPlaceholderIsAssigneeOfSpecificFunction(
                expr.target.ref,
                functionCallName,
                correctAssigneePosition,
                placeholderBackwardSlice
            );
        }

        return false;
    }


    /**
     * Extract all placeholders from a call by traversing its AST. 
     * @param call The call to extract placeholders from.
     * @returns An array of all placeholders found in the call.
     */
    private extractPlaceholders(call: SdsCall): SdsPlaceholder[] {
        const candidates = new Set<SdsPlaceholder>();

        AstUtils.streamAllContents(call).forEach(node => {
            if (!isSdsReference(node)) {
                return;
            }
            const decl = node.target?.ref;
            if (isSdsPlaceholder(decl)) {
                candidates.add(decl);
            }
        });
        
        return Array.from(candidates);
    }

    /**
     * Extract all placeholders that are data (Image, ImageList, Cell, Row, Column, Table, Dataset) from a call.
     * @param call The call to extract data placeholders from.
     * @returns An array of all data placeholders found in the call.
     */
    private extractOnlyDataPlaceholders(call: SdsCall): SdsPlaceholder[] {
        const candidates = this.extractPlaceholders(call);
        const dataPlaceholders = candidates.filter(placeholder =>
            this.isData(placeholder)
        );
        return dataPlaceholders;
    }

    callReferencesTrainingSet(call: SdsCall): boolean {
        const candidates = this.extractOnlyDataPlaceholders(call);
        
        for (const placeholder of candidates) {
            console.log(placeholder.name);
            if (this.checkIfPlaceholderIsAssigneeOfSpecificFunction(
                    placeholder, 'splitRows', 0)
                && 
                !this.checkIfPlaceholderIsAssigneeOfSpecificFunction(
                    placeholder, 'splitRows', 1)
                ) {
                console.log("Placeholder " + placeholder.name + " is training set");
                return true;
            }
        }
        return false;
    }

    callReferencesValidationSet(call: SdsCall): boolean{
        const candidates = this.extractOnlyDataPlaceholders(call);
        
        for (const placeholder of candidates) {
            // console.log(placeholder.name);
            if (this.checkIfPlaceholderIsAssigneeOfSpecificFunction(
                    placeholder, 'splitRows', 0)
                && 
                this.checkIfPlaceholderIsAssigneeOfSpecificFunction(
                    placeholder, 'splitRows', 1)
                ) {
                console.log("Placeholder " + placeholder.name + " is validation set");
                return true;
            }
        }
        return false;
    }

    callReferencesTestSet(call: SdsCall): boolean{
        const candidates = this.extractOnlyDataPlaceholders(call);
        
        for (const placeholder of candidates) {
            // console.log(placeholder.name);
            if (!this.checkIfPlaceholderIsAssigneeOfSpecificFunction(
                    placeholder, 'splitRows', 0)
                && 
                this.checkIfPlaceholderIsAssigneeOfSpecificFunction(
                    placeholder, 'splitRows', 1)
                ) {
                console.log("Placeholder " + placeholder.name + " is test set");
                return true;
            }
        }
        return false;    
    }

    private isData = (placeholder: SdsPlaceholder): boolean => {
        const typeComputer = this.services.typing.TypeComputer;
        const builtinClasses = this.services.builtins.Classes;
        
        const type = typeComputer.computeType(placeholder);

        // image
        const imageMatch        =  typeComputer.computeMatchingSupertype(type as ClassType, builtinClasses.Image);
        const imageListMatch    =  typeComputer.computeMatchingSupertype(type as ClassType, builtinClasses.ImageList);

        // tabular
        const cellMatch     = typeComputer.computeMatchingSupertype(type as ClassType, builtinClasses.Cell);
        const rowMatch      = typeComputer.computeMatchingSupertype(type as ClassType, builtinClasses.Row);
        const columnMatch   = typeComputer.computeMatchingSupertype(type as ClassType, builtinClasses.Column);
        const tableMatch    = typeComputer.computeMatchingSupertype(type as ClassType, builtinClasses.Table);
        
        // datasets (use only most general supertype)
        const datasetMatch  = typeComputer.computeMatchingSupertype(type as ClassType, builtinClasses.Dataset);

        if(imageMatch || imageListMatch || cellMatch || rowMatch || columnMatch || tableMatch || datasetMatch){
            return true;
        } else { 
            return false;
        }
    }
}