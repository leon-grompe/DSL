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
     * Checks if a placeholder is assigned to a specific assginee position by a specific function.
     * @param placeholder The placeholder to check.
     * @param functionCallName The name of the function callable.
     * @param correctAssigneePosition The assignee position to check.
     * @param placeholderBackwardSlice Accumulates the backwardsslice to the placeholder.
     * @returns True, if the placeholder is assigned by the specified function at the specified position. False otherwise.
     */
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

    /**
     * Checks if any data placeholders in a call reference the training set (assigned by first splitRows at position 0)
     * @param call 
     * @returns True, if the call references the training set through data. False otherwise.
     */
    callReferencesTrainingSet(call: SdsCall): boolean {
        const candidates = this.extractOnlyDataPlaceholders(call);
        
        for (const placeholder of candidates) {
            if (this.checkIfPlaceholderIsAssigneeOfSpecificFunction(
                    placeholder, 'splitRows', 0)
                && 
                !this.checkIfPlaceholderIsAssigneeOfSpecificFunction(
                    placeholder, 'splitRows', 1)
                ) {
                return true;
            }
        }
        return false;
    }

    /**
     * Checks if any data placeholders in a call reference the validation set (assigned by second splitRows at position 0)
     * @param call 
     * @returns True, if the call references the validation set through data. False otherwise.
     */
    callReferencesValidationSet(call: SdsCall): boolean{
        const candidates = this.extractOnlyDataPlaceholders(call);
        
        for (const placeholder of candidates) {
            if (this.checkIfPlaceholderIsAssigneeOfSpecificFunction(
                    placeholder, 'splitRows', 0)
                && 
                this.checkIfPlaceholderIsAssigneeOfSpecificFunction(
                    placeholder, 'splitRows', 1)
                ) {
                return true;
            }
        }
        return false;
    }

    /**
     * Checks if any data placeholders in a call reference the test set (assigned by second splitRows at position 1)
     * @param call 
     * @returns True, if the call references the test set through data. False otherwise.
     */
    callReferencesTestSet(call: SdsCall): boolean{
        const candidates = this.extractOnlyDataPlaceholders(call);
        
        for (const placeholder of candidates) {
            if (!this.checkIfPlaceholderIsAssigneeOfSpecificFunction(
                    placeholder, 'splitRows', 0)
                && 
                this.checkIfPlaceholderIsAssigneeOfSpecificFunction(
                    placeholder, 'splitRows', 1)
                ) {
                return true;
            }
        }
        return false;    
    }

    /**
     * Checks if a placeholder is actual data (Image, ImageList, any Tabular data or a Dataset).
     * @param placeholder 
     * @returns True if the placeholder is data. False otherwise.
     */
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